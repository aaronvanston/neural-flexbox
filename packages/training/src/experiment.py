"""Validation-only experiments. Never overwrite the deployed checkpoint."""
import argparse, copy, json, time, hashlib
from pathlib import Path
import torch
from torch import nn
from encoding import encoded_inputs
p=argparse.ArgumentParser()
p.add_argument('--name',required=True);p.add_argument('--epochs',type=int,default=1000)
p.add_argument('--width',type=int,default=96);p.add_argument('--depth',type=int,default=2)
p.add_argument('--lr',type=float,default=.0003)
p.add_argument('--features',type=int,default=1)
p.add_argument('--device',default='cpu')
p.add_argument('--batch',type=int,default=2048)
p.add_argument('--resume')
p.add_argument('--expand',action='store_true',help='Widen a resumed network by duplicating hidden units with small symmetry-breaking noise')
p.add_argument('--extra',action='store_true')
p.add_argument('--balanced',action='store_true')
p.add_argument('--layout-balanced',action='store_true')
p.add_argument('--beta',type=float,default=1)
a=p.parse_args()
root=Path(__file__).resolve().parents[3]
out=root/'packages/training/runs'/a.name;out.mkdir(parents=True,exist_ok=True)
torch.set_num_threads(4);torch.manual_seed(20260911)
def dataset(split):
 rows=json.loads((root/f'data/{split}.json').read_text())
 if split=='train' and a.extra:rows+=json.loads((root/'data/train-extra.json').read_text())
 if split=='train' and a.balanced:rows+=json.loads((root/'data/train-balanced.json').read_text())
 x=torch.tensor(encoded_inputs(rows,a.features),dtype=torch.float32)
 if a.features>=2:
  scale=x[:,0].clone()
  for j in [0,1,9,13,15,16,18]:x[:,j]/=scale
 if a.features>=3:
  n=x[:,2]*8; index=x[:,12]*8; gap=x[:,1]/10
  extra=torch.stack([gap*(n-1),gap*index,(x[:,14]>0).float(),(x[:,15]>0).float()],dim=1)
  x=torch.cat([x,extra],dim=1)
 y=torch.tensor([v for r in rows for v in r['target']],dtype=torch.float32)
 w=torch.tensor([r['config']['width'] for r in rows for _ in r['input']],dtype=torch.float32)
 return x.to(a.device),y.to(a.device),w.to(a.device)
x,y,w=dataset('train');vx,vy,vw=dataset('validation')
modules=[];last=x.shape[1]
for _ in range(a.depth):modules.extend([nn.Linear(last,a.width),nn.ReLU()]);last=a.width
modules.append(nn.Linear(last,2));model=nn.Sequential(*modules).to(a.device)
if a.resume:
 checkpoint=json.loads((root/a.resume).read_text())
 linear=[m for m in model if isinstance(m,nn.Linear)]
 if len(linear)!=len(checkpoint['layers']):raise ValueError('Resume depth mismatch')
 for i,(module,layer) in enumerate(zip(linear,checkpoint['layers'])):
  weight=torch.tensor(layer['weight']);bias=torch.tensor(layer['bias'])
  if a.expand:
   rows,cols=module.weight.shape
   if rows%weight.shape[0] or cols%weight.shape[1]:raise ValueError('Expansion requires integer width multiples')
   row_factor=rows//weight.shape[0];col_factor=cols//weight.shape[1]
   weight=weight.repeat(row_factor,col_factor)/col_factor
   bias=bias.repeat(row_factor)
   if i<len(linear)-1:weight+=torch.randn_like(weight)*1e-5
  module.weight.data.copy_(weight);module.bias.data.copy_(bias)
optimizer=torch.optim.AdamW(model.parameters(),lr=a.lr,weight_decay=0)
scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,a.epochs,eta_min=a.lr*.01)
best=float('inf');history=[];start=time.time()
for epoch in range(a.epochs):
 for ids in torch.randperm(len(x),device=a.device).split(a.batch):
  pred=model(x[ids]);errors=nn.functional.smooth_l1_loss(pred*w[ids,None],y[ids]*w[ids,None],beta=a.beta,reduction='none')
  loss=(errors.mean(dim=1)/(x[ids,2]*8)).mean() if a.layout_balanced else errors.mean()
  optimizer.zero_grad();loss.backward();optimizer.step()
 scheduler.step()
 with torch.no_grad():score=((model(vx)-vy).abs()*vw[:,None]).mean().item()
 if score<best:best=score;best_state=copy.deepcopy(model.state_dict());selected=epoch+1
 if (epoch+1)%50==0:
  print(f'{a.name} epoch {epoch+1}: val={score:.4f}px best={best:.4f}px elapsed={time.time()-start:.1f}s',flush=True)
  history.append({'epoch':epoch+1,'validationMaePx':score})
model.load_state_dict(best_state)
with torch.no_grad():
 error=(model(vx)-vy).abs()*vw[:,None]
 metrics={'maePx':error.mean().item(),'p95Px':torch.quantile(error.flatten(),.95).item(),'maxPx':error.max().item()}
with torch.no_grad():
 train_mae=sum(((model(xb)-yb).abs()*wb[:,None]).sum().item() for xb,yb,wb in zip(x.split(a.batch),y.split(a.batch),w.split(a.batch)))/(len(x)*2)
layers=[{'weight':m.weight.detach().tolist(),'bias':m.bias.detach().tolist()} for m in model if isinstance(m,nn.Linear)]
(out/'weights.json').write_text(json.dumps({'featureVersion':a.features,'layers':layers},separators=(',',':')))
training_data={name:hashlib.sha256((root/f'data/{name}.json').read_bytes()).hexdigest() for name in ((['train','train-extra'] if a.extra else ['train'])+(['train-balanced'] if a.balanced else []))}
meta={'trainingDataSha256':training_data,**vars(a),'selectedEpoch':selected,'trainingSeconds':time.time()-start,'validation':metrics,'trainingMaePx':train_mae,'history':history,'parameters':sum(p.numel() for p in model.parameters())}
(out/'experiment.json').write_text(json.dumps(meta,indent=2))
print(json.dumps(meta),flush=True)
