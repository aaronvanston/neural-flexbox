"""Evaluate a selected run and create a reviewable deployment candidate."""
import argparse, hashlib, json, shutil
from pathlib import Path
import torch
from torch import nn
from encoding import encoded_inputs
p=argparse.ArgumentParser();p.add_argument('run');p.add_argument('--target',type=float,default=1);p.add_argument('--fresh-test',action='store_true');p.add_argument('--compression-test',action='store_true');p.add_argument('--balanced-test',action='store_true');a=p.parse_args()
root=Path(__file__).resolve().parents[3]
run=root/'packages/training/runs'/a.run
experiment=json.loads((run/'experiment.json').read_text())
weights=json.loads((run/'weights.json').read_text())
version=weights.get('featureVersion',1)
torch.set_num_threads(4)
modules=[]
for i,layer in enumerate(weights['layers']):
 m=nn.Linear(len(layer['weight'][0]),len(layer['bias']))
 m.weight.data.copy_(torch.tensor(layer['weight']));m.bias.data.copy_(torch.tensor(layer['bias']))
 modules.append(m)
 if i<len(weights['layers'])-1:modules.append(nn.ReLU())
model=nn.Sequential(*modules).eval()
def encode(rows):
 x=torch.tensor(encoded_inputs(rows,version),dtype=torch.float32)
 if version>=2:
  scale=x[:,0].clone()
  for j in [0,1,9,13,15,16,18]:x[:,j]/=scale
 if version>=3:
  n=x[:,2]*8; index=x[:,12]*8; gap=x[:,1]/10
  x=torch.cat([x,torch.stack([gap*(n-1),gap*index,(x[:,14]>0).float(),(x[:,15]>0).float()],dim=1)],dim=1)
 return x
manifest=json.loads((root/'data/manifest.json').read_text());metrics={}
if a.compression_test or a.balanced_test:a.fresh_test=True
fresh_name='test-balanced-natural' if a.balanced_test else 'test-compression' if a.compression_test else 'test-fresh'
if a.fresh_test:
 fresh_manifest=json.loads((root/f'data/{fresh_name}-manifest.json').read_text())
 manifest['splits'][fresh_name]=fresh_manifest['splits'][fresh_name]
 manifest['freshTest']=fresh_manifest
test_split=fresh_name if a.fresh_test else 'test'
def summarize(error):
 return {'boxes':len(error),'maePx':error.mean().item(),'p95Px':torch.quantile(error.flatten(),.95).item(),'maxPx':error.max().item(),'xMaePx':error[:,0].mean().item(),'widthMaePx':error[:,1].mean().item(),'coordinatesUnder1Px':(error<1).float().mean().item(),'boxesUnder1Px':(error.max(dim=1).values<1).float().mean().item()}
with torch.no_grad():
 for split in ['validation',test_split,'ood']:
  raw=(root/f'data/{split}.json').read_bytes()
  assert hashlib.sha256(raw).hexdigest()==manifest['splits'][split]['sha256'],'Dataset changed'
  rows=json.loads(raw);x=encode(rows)
  y=torch.tensor([v for r in rows for v in r['target']],dtype=torch.float32)
  w=torch.tensor([r['config']['width'] for r in rows for _ in r['input']],dtype=torch.float32)
  error=(model(x)-y).abs()*w[:,None]
  metrics[split]=summarize(error)
  modes=[r['config']['justify'] for r in rows for _ in r['input']]
  metrics[split]['byJustify']={mode:summarize(error[torch.tensor([m==mode for m in modes])]) for mode in sorted(set(modes))}
 rows=json.loads((root/f'data/{test_split}.json').read_text())[:100]
 fixtures=[{'config':r['config'],'prediction':(model(encode([r]))*r['config']['width']).tolist()} for r in rows]
meta={'formatVersion':1,'featureVersion':version,'architecture':[len(weights['layers'][0]['weight'][0])]+[len(l['bias']) for l in weights['layers']], 'targetMaePx':a.target,'parameters':experiment['parameters'],'seed':20260911,'selectedEpoch':experiment['selectedEpoch'],'epochs':experiment['epochs'],'trainingSeconds':experiment['trainingSeconds'],'torchVersion':torch.__version__,'trainingDevice':experiment['device'],'manifest':manifest,'metrics':metrics,'experiment':experiment,'weightsSha256':hashlib.sha256((run/'weights.json').read_bytes()).hexdigest()}
out=run/'candidate';out.mkdir(exist_ok=True)
shutil.copyfile(run/'weights.json',out/'weights.json')
meta['trainingLayouts']=manifest['splits']['train']['layouts']
if experiment.get('extra'):
 extra_manifest=json.loads((root/'data/train-extra-manifest.json').read_text())
 meta['additionalTrainingData']=extra_manifest
 meta['trainingLayouts']+=extra_manifest['splits']['train-extra']['layouts']
if experiment.get('balanced'):
 balanced_manifest=json.loads((root/'data/train-balanced-manifest.json').read_text())
 meta['balancedTrainingData']=balanced_manifest
 meta['trainingLayouts']+=balanced_manifest['splits']['train-balanced']['layouts']
for split,expected_hash in experiment.get('trainingDataSha256',{}).items():
 assert hashlib.sha256((root/f'data/{split}.json').read_bytes()).hexdigest()==expected_hash, 'Training data changed'
if (run/'runtime.json').exists():
 meta['runtime']=json.loads((run/'runtime.json').read_text())
 meta['quantization']=experiment['quantization']
 for suffix in ['', '.br', '.gz']:
  shutil.copyfile(run/(meta['runtime']['file']+suffix),out/(meta['runtime']['file']+suffix))
(out/'metrics.json').write_text(json.dumps(meta,indent=2));(out/'parity.json').write_text(json.dumps(fixtures))
print(json.dumps({split:{k:v for k,v in m.items() if k!='byJustify'} for split,m in metrics.items()},indent=2))
