"""Canonicalize irrelevant input properties for experimental feature version 4."""
def encoded_inputs(rows, version):
    result=[]
    for row in rows:
        c=row['config']
        free=c['width']-c['gap']*(len(c['items'])-1)-sum(a['basis'] for a in c['items'])
        grows=sum(a['grow'] for a in c['items'])
        for original in row['input']:
            v=original.copy()
            if version==4:
                if free>=0:
                    v[11]=1;v[15]=v[13];v[18]=v[16]
                    if grows>0:v[3:9]=[1,0,0,0,0,0]
                else:
                    v[10]=v[14]=v[17]=0
            result.append(v)
    return result
