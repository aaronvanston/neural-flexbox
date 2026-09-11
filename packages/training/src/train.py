"""Reproduce the accepted training recipe, or fine-tune a separate candidate. Never auto-promote."""
import argparse,subprocess,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--device',choices=['cpu','cuda'],default='cpu');p.add_argument('--full',action='store_true');p.add_argument('--epochs',type=int,default=500);a=p.parse_args()
root=Path(__file__).resolve().parents[3]
script=root/'packages/training/src';runs='packages/training/runs'
def run(name,args):subprocess.run([sys.executable,str(script/name),*map(str,args)],cwd=root,check=True)
common=['--device',a.device,'--width',128,'--depth',3,'--batch',2048]
if not a.full:
 run('experiment.py',['--name','continuation','--features',4,'--epochs',a.epochs,'--lr',.00002,'--extra','--balanced','--layout-balanced','--beta',.2,'--resume','packages/training/active/weights-f32.json',*common]);sys.exit(0)
# Successful recipe stages only. Checkpoints remain under ignored runs/.
run('experiment.py',['--name','seed-float','--features',3,'--epochs',3000,'--lr',.0007,*common])
run('experiment.py',['--name','expanded-float','--features',3,'--epochs',1800,'--lr',.00008,'--beta',.5,'--extra','--resume',f'{runs}/seed-float/weights.json',*common])
run('experiment.py',['--name','balanced-float','--features',3,'--epochs',1800,'--lr',.00003,'--beta',.2,'--extra','--balanced','--layout-balanced','--resume',f'{runs}/expanded-float/weights.json',*common])
run('experiment.py',['--name','canonical-float','--features',4,'--epochs',1500,'--lr',.00003,'--beta',.2,'--extra','--balanced','--layout-balanced','--resume',f'{runs}/balanced-float/weights.json',*common])
q=['--device',a.device,'--bits',8,'--float-head','--extra','--balanced','--layout-balanced','--beta',.2]
run('quantize.py',['--name','qat8','--epochs',150,'--lr',.000003,'--equalize','--source',f'{runs}/canonical-float/weights.json',*q])
run('quantize.py',['--name','calibrated8','--epochs',800,'--lr',.000002,'--mode','calibrate','--source',f'{runs}/qat8/weights.json',*q])
print('Candidate trained. Package, evaluate and review before changing active weights.')
