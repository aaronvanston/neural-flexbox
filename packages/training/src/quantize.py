"""Measure post-training quantization or fine-tune with simulated integer weights.

Selection uses validation only; writes a candidate run, never the live demo.
"""
import argparse
import copy
import hashlib
import json
import struct
import time
from pathlib import Path

import torch
from torch import nn
from encoding import encoded_inputs
from torch.nn import functional as F

FEATURE_VERSION = 3
ROOT = Path(__file__).resolve().parents[3]


def dataset(split, device):
    rows = json.loads((ROOT / f'data/{split}.json').read_text())
    x = torch.tensor(encoded_inputs(rows,FEATURE_VERSION), dtype=torch.float32)
    scale = x[:, 0].clone()
    for j in [0, 1, 9, 13, 15, 16, 18]:
        x[:, j] /= scale
    n, index, gap = x[:, 2] * 8, x[:, 12] * 8, x[:, 1] / 10
    x = torch.cat([x, torch.stack([gap*(n-1), gap*index,
        (x[:,14]>0).float(), (x[:,15]>0).float()], dim=1)], dim=1)
    y = torch.tensor([v for r in rows for v in r['target']], dtype=torch.float32)
    widths = torch.tensor([r['config']['width'] for r in rows for _ in r['input']], dtype=torch.float32)
    return x.to(device), y.to(device), widths.to(device)


class QuantizedLinear(nn.Module):
    def __init__(self, layer, bits):
        super().__init__()
        self.weight = nn.Parameter(torch.tensor(layer['weight'], dtype=torch.float32))
        self.bias = nn.Parameter(torch.tensor(layer['bias'], dtype=torch.float32))
        self.limit = 2**(bits-1)-1
        self.register_buffer('scale', self.weight.detach().abs().amax(dim=1, keepdim=True).clamp_min(1e-12)/self.limit)

    def integers(self):
        if hasattr(self, 'fixed_integers'):
            return self.fixed_integers
        return (self.weight/self.scale).round().clamp(-self.limit, self.limit)

    def forward(self, x):
        if getattr(self, 'float_head', False):
            return F.linear(x,self.weight,self.bias)
        quantized = self.integers()*self.scale
        # Straight-through estimator: forward is exactly dequantized integer weights.
        weight = self.weight + (quantized-self.weight).detach() if self.training and not hasattr(self, 'fixed_integers') else quantized
        return F.linear(x, weight, self.bias)


def pack_integers(values, bits):
    out = bytearray()
    buffer = count = 0
    for q in values:
        buffer |= (int(q) & ((1 << bits)-1)) << count
        count += bits
        while count >= 8:
            out.append(buffer & 255)
            buffer >>= 8
            count -= 8
    if count:
        out.append(buffer & 255)
    return out


def read_packed(path, expected_bits):
    data = path.read_bytes()
    magic, version, feature, bits, count = struct.unpack_from('<4sBBBB', data)
    if magic != b'NFLX' or version not in [1,2] or feature != FEATURE_VERSION or bits != expected_bits:
        raise ValueError('Source binary format mismatch')
    offset, result = 8, []
    for index in range(count):
        columns, rows = struct.unpack_from('<HH', data, offset)
        offset += 4
        if version == 2 and index == count-1:
            offset += rows*4+rows*columns*4
            result.append((None,None))
            continue
        scales = torch.tensor(struct.unpack_from(f'<{rows}f',data,offset)).reshape(-1,1)
        offset += rows*8  # Scales and biases; bias values are already in the JSON export.
        values = []
        for i in range(rows*columns):
            bit = i*bits; byte = offset+bit//8; shift = bit%8
            value = (data[byte] | ((data[byte+1] if shift+bits>8 else 0)<<8))>>shift
            value &= (1<<bits)-1
            if value & (1<<(bits-1)):
                value -= 1<<bits
            values.append(value)
        offset += (rows*columns*bits+7)//8
        result.append((scales,torch.tensor(values,dtype=torch.float32).reshape(rows,columns)))
    if offset != len(data):
        raise ValueError('Trailing binary data')
    return result


def save(model, bits, out):
    layers = [m for m in model if isinstance(m, QuantizedLinear)]
    blob = bytearray(b'NFLX') + bytes([2 if getattr(layers[-1],'float_head',False) else 1, FEATURE_VERSION, bits, len(layers)])
    decoded = []
    for layer in layers:
        rows, columns = layer.weight.shape
        blob.extend(struct.pack('<HH', columns, rows))
        scales = layer.scale.detach().cpu().flatten().tolist()
        biases = layer.bias.detach().cpu().tolist()
        if getattr(layer,'float_head',False):
            weights = layer.weight.detach().cpu()
            blob.extend(struct.pack(f'<{rows}f',*biases))
            blob.extend(struct.pack(f'<{weights.numel()}f',*weights.flatten().tolist()))
            decoded.append({'weight':weights.tolist(),'bias':biases})
            continue
        blob.extend(struct.pack(f'<{rows}f', *scales))
        blob.extend(struct.pack(f'<{rows}f', *biases))
        integers = layer.integers().detach().cpu().to(torch.int32)
        blob.extend(pack_integers(integers.flatten().tolist(), bits))
        decoded.append({'weight':(integers*layer.scale.detach().cpu()).tolist(), 'bias':biases})
    (out/'weights.bin').write_bytes(blob)
    (out/'weights.json').write_text(json.dumps({'featureVersion':FEATURE_VERSION,'layers':decoded},separators=(',',':')))


def main():
    global FEATURE_VERSION
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', required=True)
    parser.add_argument('--bits', type=int, choices=[4, 6, 8], required=True)
    parser.add_argument('--epochs', type=int, default=0)
    parser.add_argument('--lr', type=float, default=.00002)
    parser.add_argument('--device', choices=['cpu','cuda'], default='cpu')
    parser.add_argument('--beta',type=float,default=1)
    parser.add_argument('--equalize',action='store_true')
    parser.add_argument('--float-head',action='store_true')
    parser.add_argument('--extra',action='store_true')
    parser.add_argument('--balanced',action='store_true')
    parser.add_argument('--layout-balanced',action='store_true')
    parser.add_argument('--mode', choices=['qat','calibrate'], default='qat')
    parser.add_argument('--source', required=True)
    args = parser.parse_args()
    torch.set_num_threads(4)
    torch.manual_seed(20260911)
    source = json.loads((ROOT/args.source).read_text())
    FEATURE_VERSION=source.get('featureVersion',3)
    if FEATURE_VERSION not in [3,4]:
        raise ValueError('Quantization requires feature version 3 or 4')
    if args.equalize:
        # Positive rescaling through ReLU preserves the float network's function.
        # Balance adjacent weight ranges before rounding to integer coefficients.
        tensors=[(torch.tensor(layer['weight'],dtype=torch.float64),torch.tensor(layer['bias'],dtype=torch.float64)) for layer in source['layers']]
        for _ in range(3):
            for i in range(len(tensors)-1):
                weight,bias=tensors[i]
                following=tensors[i+1][0]
                incoming=weight.abs().amax(dim=1).clamp_min(1e-12)
                outgoing=following.abs().amax(dim=0).clamp_min(1e-12)
                factor=(incoming/outgoing).sqrt().clamp(.1,10)
                weight.div_(factor[:,None]);bias.div_(factor)
                following.mul_(factor[None,:])
        source['layers']=[{'weight':w.float().tolist(),'bias':b.float().tolist()} for w,b in tensors]
    modules = []
    for i, layer in enumerate(source['layers']):
        modules.append(QuantizedLinear(layer,args.bits))
        if i<len(source['layers'])-1:
            modules.append(nn.ReLU())
    model = nn.Sequential(*modules).to(args.device)
    model[-1].float_head=args.float_head
    if args.mode == 'calibrate':
        binary = (ROOT/args.source).with_suffix('.bin')
        packed = iter(read_packed(binary,args.bits)) if binary.exists() and not args.equalize else None
        for layer in model:
            if isinstance(layer, QuantizedLinear):
                if getattr(layer,'float_head',False):
                    if packed is not None:next(packed)
                    continue
                if packed is not None:
                    scale, integers = next(packed)
                    layer.scale.copy_(scale.to(args.device))
                else:
                    integers = layer.integers().detach().clone()
                layer.register_buffer('fixed_integers', integers.to(args.device))
                layer.weight.requires_grad_(False)
                scale = layer.scale.clone()
                del layer._buffers['scale']
                layer.scale = nn.Parameter(scale)
    vx, vy, vw = dataset('validation',args.device)
    def evaluate():
        model.eval()
        with torch.no_grad():
            e=(model(vx)-vy).abs()*vw[:,None]
            return {'maePx':e.mean().item(),'p95Px':torch.quantile(e.flatten(),.95).item(),'maxPx':e.max().item()}
    initial = evaluate()
    best, selected, best_state = initial['maePx'], 0, copy.deepcopy(model.state_dict())
    print(f'Initial {args.bits}-bit validation: {initial}',flush=True)
    start, history = time.time(), []
    if args.epochs:
        x,y,w = dataset('train',args.device)
        if args.extra:
            ex,ey,ew = dataset('train-extra',args.device)
            x,y,w = torch.cat([x,ex]),torch.cat([y,ey]),torch.cat([w,ew])
        if args.balanced:
            ex,ey,ew = dataset('train-balanced',args.device)
            x,y,w = torch.cat([x,ex]),torch.cat([y,ey]),torch.cat([w,ew])
        optimizer = torch.optim.AdamW(model.parameters(),lr=args.lr,weight_decay=0)
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,args.epochs,eta_min=args.lr*.01)
        for epoch in range(args.epochs):
            model.train()
            for ids in torch.randperm(len(x),device=args.device).split(2048):
                prediction = model(x[ids])
                errors = F.smooth_l1_loss(prediction*w[ids,None],y[ids]*w[ids,None],beta=args.beta,reduction='none')
                loss = (errors.mean(dim=1)/(x[ids,2]*8)).mean() if args.layout_balanced else errors.mean()
                optimizer.zero_grad(); loss.backward(); optimizer.step()
                if args.mode == 'calibrate':
                    with torch.no_grad():
                        for layer in model:
                            if isinstance(layer, QuantizedLinear):
                                layer.scale.clamp_(min=1e-12)
            scheduler.step()
            metrics = evaluate()
            if metrics['maePx']<best:
                best, selected, best_state = metrics['maePx'], epoch+1, copy.deepcopy(model.state_dict())
            if (epoch+1)%50==0:
                history.append({'epoch':epoch+1,**metrics})
                print(f'{args.name} epoch {epoch+1}: val={metrics["maePx"]:.4f}px best={best:.4f}px elapsed={time.time()-start:.1f}s',flush=True)
    model.load_state_dict(best_state)
    out = ROOT/'packages/training/runs'/args.name
    out.mkdir(parents=True,exist_ok=True)
    save(model,args.bits,out)
    training_data = {name:hashlib.sha256((ROOT/f'data/{name}.json').read_bytes()).hexdigest() for name in ((['train','train-extra'] if args.extra else ['train'])+(['train-balanced'] if args.balanced else []))}
    metadata = {'trainingDataSha256':training_data,**vars(args),'features':FEATURE_VERSION,'seed':20260911,'parameters':sum(m.weight.numel()+m.bias.numel() for m in model if isinstance(m,QuantizedLinear)),
        'trainableParameters':sum(p.numel() for p in model.parameters() if p.requires_grad),
        'selectedEpoch':selected,'trainingSeconds':time.time()-start,'torchVersion':torch.__version__,
        'initialValidation':initial,'validation':evaluate(),'history':history,
        'quantization':{'bits':args.bits,'scheme':'symmetric-per-output-channel','bias':'float32','scales':'learned-float32' if args.mode=='calibrate' else 'fixed-float32',
        'outputWeights':'float32' if args.float_head else f'int{args.bits}',
        'format':'NFLX-v2' if args.float_head else 'NFLX-v1','weightBytes':(out/'weights.bin').stat().st_size}}
    (out/'experiment.json').write_text(json.dumps(metadata,indent=2))
    print(json.dumps({k:v for k,v in metadata.items() if k!='history'},indent=2),flush=True)


if __name__=='__main__':
    main()
