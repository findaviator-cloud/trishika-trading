import numpy as np, pandas as pd, warnings; warnings.filterwarnings('ignore')
K=2.0; TOL=0.75; HOLD=4
def atr_series(df):
    pc=df.close.shift(1); tr=pd.concat([df.high-df.low,(df.high-pc).abs(),(df.low-pc).abs()],axis=1).max(axis=1); return tr.ewm(alpha=1/14,min_periods=14,adjust=False).mean()
def detect(df):
    """Causal zig-zag; returns signals (bar, dir, kind, stop, target)  kind in HALF_M, FULL_M, HALF_W, FULL_W."""
    H=df.high.values; L=df.low.values; C=df.close.values; A=atr_series(df).values; n=len(df)
    dirn=0; hi=H[0]; hi_i=0; lo=L[0]; lo_i=0; highs=[]; lows=[]; sigs=[]; act=[]
    for i in range(1,n):
        a=A[i]
        if np.isnan(a):
            if H[i]>hi: hi,hi_i=H[i],i
            if L[i]<lo: lo,lo_i=L[i],i
            continue
        newH=newL=False
        if dirn>=0 and H[i]>hi: hi,hi_i=H[i],i
        if dirn<=0 and L[i]<lo: lo,lo_i=L[i],i
        if dirn>=0 and L[i]<=hi-K*a: highs.append((hi_i,hi)); newH=True; dirn=-1; lo,lo_i=L[i],i
        elif dirn<=0 and H[i]>=lo+K*a: lows.append((lo_i,lo)); newL=True; dirn=1; hi,hi_i=H[i],i
        if newH and len(highs)>=2:
            (i1,p1),(i2,p2)=highs[-2],highs[-1]; mid=[l for l in lows if i1<l[0]<i2]
            if mid and abs(p1-p2)<=TOL*a:
                neck=min(l[1] for l in mid); top=max(p1,p2); height=(p1+p2)/2-neck
                if height>0.5*a:
                    sigs.append((i,-1,"HALF_M",top+0.25*a,neck)); act.append(dict(t="M",neck=neck,top=top,h=height,start=i))
        if newL and len(lows)>=2:
            (i1,p1),(i2,p2)=lows[-2],lows[-1]; mid=[h for h in highs if i1<h[0]<i2]
            if mid and abs(p1-p2)<=TOL*a:
                neck=max(h[1] for h in mid); bot=min(p1,p2); height=neck-(p1+p2)/2
                if height>0.5*a:
                    sigs.append((i,1,"HALF_W",bot-0.25*a,neck)); act.append(dict(t="W",neck=neck,bot=bot,h=height,start=i))
        keep=[]
        for p in act:
            if i-p['start']>60: continue
            if p['t']=="M":
                if C[i]>p['top']+0.5*a: continue
                if C[i]<p['neck']: sigs.append((i,-1,"FULL_M",p['top']+0.25*a,p['neck']-p['h'])); continue
            else:
                if C[i]<p['bot']-0.5*a: continue
                if C[i]>p['neck']: sigs.append((i,1,"FULL_W",p['bot']-0.25*a,p['neck']+p['h'])); continue
            keep.append(p)
        act=keep
    return sigs,A

RMIN,RMAX=0.30,0.85
def detect_n(df):
    """N pattern = leg 1 (impulse), pullback (30-85% retrace, higher low / lower high), then continuation. HALF = pullback confirmed, FULL = old extreme broken."""
    H=df.high.values; L=df.low.values; C=df.close.values; A=atr_series(df).values; n=len(df)
    dirn=0; hi=H[0]; hi_i=0; lo=L[0]; lo_i=0; highs=[]; lows=[]; sigs=[]; act=[]
    for i in range(1,n):
        a=A[i]
        if np.isnan(a):
            if H[i]>hi: hi,hi_i=H[i],i
            if L[i]<lo: lo,lo_i=L[i],i
            continue
        newH=newL=False
        if dirn>=0 and H[i]>hi: hi,hi_i=H[i],i
        if dirn<=0 and L[i]<lo: lo,lo_i=L[i],i
        if dirn>=0 and L[i]<=hi-K*a: highs.append((hi_i,hi)); newH=True; dirn=-1; lo,lo_i=L[i],i
        elif dirn<=0 and H[i]>=lo+K*a: lows.append((lo_i,lo)); newL=True; dirn=1; hi,hi_i=H[i],i
        if newL and len(lows)>=2 and highs:                       # bullish N: L0 -> H1 -> L2 (higher low)
            (i2,L2)=lows[-1]; (i0,L0)=lows[-2]; h1=[h for h in highs if i0<h[0]<i2]
            if h1:
                H1=h1[-1][1]; leg=H1-L0
                if L2>L0 and leg>=2*a and RMIN<=(H1-L2)/leg<=RMAX:
                    sigs.append((i,1,"HALF_N",L2-0.25*a,L2+leg)); act.append(dict(t="N",lvl=H1,low=L2,leg=leg,start=i))
        if newH and len(highs)>=2 and lows:                       # bearish inverted N: H0 -> L1 -> H2 (lower high)
            (i2,H2)=highs[-1]; (i0,H0)=highs[-2]; l1=[l for l in lows if i0<l[0]<i2]
            if l1:
                L1=l1[-1][1]; leg=H0-L1
                if H2<H0 and leg>=2*a and RMIN<=(H2-L1)/leg<=RMAX:
                    sigs.append((i,-1,"HALF_IN",H2+0.25*a,H2-leg)); act.append(dict(t="IN",lvl=L1,high=H2,leg=leg,start=i))
        keep=[]
        for p in act:
            if i-p['start']>60: continue
            if p['t']=="N":
                if C[i]<p['low']-0.5*a: continue
                if C[i]>p['lvl']: sigs.append((i,1,"FULL_N",p['low']-0.25*a,p['lvl']+p['leg'])); continue
            else:
                if C[i]>p['high']+0.5*a: continue
                if C[i]<p['lvl']: sigs.append((i,-1,"FULL_IN",p['high']+0.25*a,p['lvl']-p['leg'])); continue
            keep.append(p)
        act=keep
    return sigs,A

def evaluate(df,sigs,A):
    O=df.open.values; Hh=df.high.values; Ll=df.low.values; C=df.close.values; n=len(df); rows=[]
    for i,d,kind,stop,target in sigs:
        if i+HOLD+1>=n or A[i]<=0: continue
        e=O[i+1]; R4=d*(C[i+HOLD]-e)/A[i]; bp4=d*(C[i+HOLD]/e-1)*1e4
        risk=(stop-e) if d==-1 else (e-stop)
        Rc=np.nan; won=np.nan
        if risk>0 and ((d==-1 and target<e) or (d==1 and target>e)):
            exitp=C[min(n-1,i+41)]; res=None
            for j in range(i+1,min(n,i+41)):
                if d==-1:
                    if Hh[j]>=stop: exitp=stop; res='L'; break
                    if Ll[j]<=target: exitp=target; res='W'; break
                else:
                    if Ll[j]<=stop: exitp=stop; res='L'; break
                    if Hh[j]>=target: exitp=target; res='W'; break
            Rc=d*(exitp-e)/risk; won=1.0 if res=='W' else 0.0
        rows.append((df.index[i],i/n,kind,d,bp4,R4,Rc,won))
    return pd.DataFrame(rows,columns=['t','frac','kind','dir','bp4','R4','Rclassic','won'])

