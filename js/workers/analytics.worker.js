/* ============================================================
 * analytics.worker.js — TradingView-Grade Web Worker Engine
 * 100/100 Multi-Engine Off-Main-Thread Processing
 * All 17 engines on Float64Array SoA Buffers
 * ============================================================ */
const STRIDE = 6;
const O_T = 0, O_O = 1, O_H = 2, O_L = 3, O_C = 4, O_V = 5;

function unpack(payload) {
    const b = new Float64Array(payload.buffer || payload);
    const n = (payload.length && typeof payload.length === 'number' && payload.stride)
        ? payload.length
        : Math.floor(b.length / STRIDE);
    const times = new Float64Array(n);
    const opens = new Float64Array(n);
    const highs = new Float64Array(n);
    const lows = new Float64Array(n);
    const closes = new Float64Array(n);
    const vols = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const o = i * STRIDE;
        times[i] = b[o + O_T];
        opens[i] = b[o + O_O];
        highs[i] = b[o + O_H];
        lows[i] = b[o + O_L];
        closes[i] = b[o + O_C];
        vols[i] = b[o + O_V];
    }
    return { n, times, opens, highs, lows, closes, vols, buf: b };
}

/* ========== TypedArray Indicators (O(n) - Float64Array Native Math) ========== */
function smaArr(src, p) {
    const n = src.length;
    const out = new Float64Array(n);
    out.fill(NaN);
    if (n < p || p <= 0) return out;
    let sum = 0;
    for (let i = 0; i < p; i++) sum += src[i];
    out[p - 1] = sum / p;
    for (let i = p; i < n; i++) { sum += src[i] - src[i - p]; out[i] = sum / p; }
    return out;
}
function emaArr(src, p) {
    const n = src.length;
    const out = new Float64Array(n);
    out.fill(NaN);
    if (n < p || p <= 0) return out;
    const k = 2 / (p + 1);
    let sum = 0;
    for (let i = 0; i < p; i++) sum += src[i];
    out[p - 1] = sum / p;
    for (let i = p; i < n; i++) out[i] = src[i] * k + out[i - 1] * (1 - k);
    return out;
}
function rmaATR(highs, lows, closes, p = 14) {
    const n = closes.length;
    const out = new Float64Array(n); out.fill(NaN);
    if (n < 2) return out;
    const tr = new Float64Array(n);
    tr[0] = highs[0] - lows[0];
    for (let i = 1; i < n; i++) tr[i] = Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1]));
    if (n <= p) { let s=0; for(let i=0;i<n;i++) s+=tr[i]; out.fill(s/n); return out; }
    let atr=0; for(let i=0;i<p;i++) atr+=tr[i]; atr/=p; out[p-1]=atr;
    for(let i=p;i<n;i++){ atr=(atr*(p-1)+tr[i])/p; out[i]=atr; }
    return out;
}
function rsiArr(closes, p = 14) {
    const n = closes.length;
    const out = new Float64Array(n); out.fill(NaN);
    if (n <= p) return out;
    let avgG=0, avgL=0;
    for(let i=1;i<=p;i++){ const d=closes[i]-closes[i-1]; if(d>=0) avgG+=d; else avgL-=d; }
    avgG/=p; avgL/=p;
    out[p] = avgL===0 ? 100 : 100 - 100/(1+avgG/avgL);
    for(let i=p+1;i<n;i++){
        const d=closes[i]-closes[i-1]; const g=d>0?d:0, l=d<0?-d:0;
        avgG=(avgG*(p-1)+g)/p; avgL=(avgL*(p-1)+l)/p;
        out[i]=avgL===0?100:100-100/(1+avgG/avgL);
    }
    return out;
}
function macdHist(closes) {
    const e12=emaArr(closes,12), e26=emaArr(closes,26), n=closes.length;
    const macd=new Float64Array(n); for(let i=0;i<n;i++) macd[i]=e12[i]-e26[i];
    const signal=emaArr(macd,9);
    const hist=new Float64Array(n); for(let i=0;i<n;i++) hist[i]=macd[i]-signal[i];
    return {macd,signal,hist};
}
function vwapSession(times, highs, lows, closes, vols) {
    const n=closes.length, out=new Float64Array(n);
    let sumPV=0, sumV=0, anchorKey=null;
    for(let i=0;i<n;i++){
        const dt=new Date(times[i]*1000 + 5.5*3600*1000);
        const h=dt.getUTCHours(), m=dt.getUTCMinutes();
        const key=`${dt.getUTCFullYear()}-${dt.getUTCMonth()}-${dt.getUTCDate()}-${h<9||(h===9&&m<15)?'pre':'ses'}`;
        if(key!==anchorKey){sumPV=0;sumV=0;anchorKey=key;}
        const typ=(highs[i]+lows[i]+closes[i])/3, v=vols[i]||0;
        sumPV+=typ*v; sumV+=v;
        out[i]=sumV===0?closes[i]:sumPV/sumV;
    }
    return out;
}

/* ========== BATCH A ENGINES ========== */
function evalChecklist(d) {
    const{n,highs,lows,closes,vols}=d;
    if(n<30)return{score:0,total:6,trend:'INSUFFICIENT DATA',reasons:[],level:'muted'};
    const ema20=emaArr(closes,20),ema50=emaArr(closes,50),rsi=rsiArr(closes,14);
    let high20=-Infinity,volSum=0,c=n-1;
    for(let i=n-20;i<n;i++){if(i<0)continue;if(highs[i]>high20)high20=highs[i];volSum+=vols[i];}
    const avgVol20=volSum/20;
    let low20=Infinity; for(let i=n-20;i<n;i++){if(i>=0&&lows[i]<low20)low20=lows[i];}
    const rng20=high20-low20||1;
    const reasons=[];let score=0;
    if(closes[c]>ema20[c]){score++;reasons.push('Above EMA20');}
    if(ema20[c]>ema50[c]){score++;reasons.push('EMA20>EMA50');}
    if(closes[c]>=high20-rng20*0.002){score++;reasons.push('20-bar breakout');}
    if(vols[c]>=avgVol20*1.5){score++;reasons.push('Vol +50%');}
    const r=rsi[c];
    if(isFinite(r)&&r>=55&&r<=78){score++;reasons.push(`RSI ${r.toFixed(0)}`);}
    const bodyRange=Math.max(highs[c]-lows[c],1e-9);
    if((closes[c]-lows[c])/bodyRange>=0.65){score++;reasons.push('Strong close');}
    let trend,level;
    if(score>=5){trend='🚀 STRONG BULL BREAKOUT';level='success';}
    else if(score>=4){trend='✅ BULLISH BREAKOUT';level='success';}
    else if(score===3){trend='⚡ SET-UP FORMING';level='warning';}
    else if(score===2){trend='➡ NEUTRAL / CHOP';level='muted';}
    else{trend='❌ BEARISH / REJECTION';level='danger';}
    return{score,total:6,trend,reasons,level};
}
function scanBreakout(d){
    const def={detected:false,direction:null,score:0,pivot:0,entry:0,sl:0,target:0,volRatio:0,reasons:[]};
    const{n,highs,lows,closes,vols}=d; if(n<30)return def;
    const atrA=rmaATR(highs,lows,closes,14),atr=atrA[n-1]||0;
    const ema20=emaArr(closes,20),ema50=emaArr(closes,50),rsi=rsiArr(closes,14);
    const mObj=macdHist(closes),hist=mObj.hist;
    let pivotHigh=-Infinity,pivotLow=Infinity;
    for(let i=n-21;i<n-1;i++){if(i<0)continue;if(highs[i]>pivotHigh)pivotHigh=highs[i];if(lows[i]<pivotLow)pivotLow=lows[i];}
    let baseRange=0; for(let i=n-6;i<n;i++)baseRange+=highs[i]-lows[i]; baseRange/=6;
    const tightBase=atr>0&&baseRange<0.8*atr;
    let v20=0,v5=0; for(let i=n-20;i<n;i++)v20+=vols[i]; for(let i=n-5;i<n;i++)v5+=vols[i];
    const volAvg20=v20/20,volAvg5=v5/5,dryUp=volAvg5<0.85*volAvg20;
    const volRatio=volAvg20>0?vols[n-1]/volAvg20:0;
    const last=n-1,range=highs[last]-lows[last],closePos=range>0?(closes[last]-lows[last])/range:0.5;
    const rv=rsi[last],mh=hist[last],mhp=last>0?hist[last-1]:0;
    let ls=0,ss=0,lr=[],sr=[];
    if(closes[last]>pivotHigh){
        if(closePos>0.65){ls+=2;lr.push('Strong close (upper 35%)');}
        if(volRatio>=1.5){ls+=2;lr.push(`Volume ${volRatio.toFixed(1)}x`);}
        if(tightBase){ls+=2;lr.push('Tight base/coil');}
        if(dryUp){ls+=1;lr.push('Volume dry-up');}
        if(ema20[last]>ema50[last]){ls+=1;lr.push('EMA20>EMA50');}
        if(isFinite(rv)&&rv>45&&rv<72){ls+=1;lr.push(`RSI ${rv.toFixed(0)}`);}
        if(mh>0&&mh>=mhp)ls+=1;
    }
    if(closes[last]<pivotLow){
        if(closePos<0.35){ss+=2;sr.push('Strong close (lower 35%)');}
        if(volRatio>=1.5){ss+=2;sr.push(`Volume ${volRatio.toFixed(1)}x`);}
        if(tightBase){ss+=2;sr.push('Tight base');}
        if(dryUp)ss+=1;
        if(ema20[last]<ema50[last])ss+=1;
        if(isFinite(rv)&&rv<55&&rv>28)ss+=1;
        if(mh<0&&mh<=mhp)ss+=1;
    }
    if(ls>=5){
        let sb=Infinity; for(let i=n-6;i<n;i++)if(lows[i]<sb)sb=lows[i];
        const sl=sb-0.25*atr,risk=closes[last]-sl;
        return{detected:true,direction:'LONG',score:ls,pivot:+pivotHigh.toFixed(2),entry:+closes[last].toFixed(2),sl:+sl.toFixed(2),target:+(closes[last]+2*risk).toFixed(2),target1:+(closes[last]+risk).toFixed(2),volRatio:+volRatio.toFixed(2),atr:+atr.toFixed(2),rr:risk>0?2:0,grade:ls>=8?'🔥 HIGH CONVICTION':ls>=6?'✅ VALID':'⚠️ WATCH',reasons:lr};
    }
    if(ss>=5){
        let sb=-Infinity; for(let i=n-6;i<n;i++)if(highs[i]>sb)sb=highs[i];
        const sl=sb+0.25*atr,risk=sl-closes[last];
        return{detected:true,direction:'SHORT',score:ss,pivot:+pivotLow.toFixed(2),entry:+closes[last].toFixed(2),sl:+sl.toFixed(2),target:+(closes[last]-2*risk).toFixed(2),target1:+(closes[last]-risk).toFixed(2),volRatio:+volRatio.toFixed(2),atr:+atr.toFixed(2),rr:risk>0?2:0,grade:ss>=8?'🔥 HIGH CONVICTION':ss>=6?'✅ VALID':'⚠️ WATCH',reasons:sr};
    }
    return def;
}
function bigCandle(d,tf){
    const def={forming:false,label:'—',level:'muted',dir:null,magnitude:0};
    const{n,times,opens,closes,vols}=d; if(n<12)return def;
    const mm={'1':1,'3':3,'5':5,'15':15,'30':30,'60':60,'D':1440},tfSec=(mm[tf]||15)*60;
    const body=Math.abs(closes[n-1]-opens[n-1]),dir=closes[n-1]>=opens[n-1]?'bull':'bear';
    let sB=0,sV=0; for(let i=n-11;i<n-1;i++){sB+=Math.abs(closes[i]-opens[i]);sV+=vols[i];}
    const aB=sB/10,aV=sV/10;
    if(aB<=0||aV<=0)return{...def,magnitude:0,volRatio:0};
    const now=Math.floor(Date.now()/1000),since=Math.max(0,now-times[n-1]);
    const pct=tfSec>0?Math.min(since/tfSec,1):1,forming=pct>=0.4&&pct<0.95;
    const mag=body/aB,vr=vols[n-1]/aV,bigEnough=mag>=1.8&&vr>=1.2;
    if(forming&&bigEnough)return{forming:true,fresh:true,label:`${dir==='bull'?'▲':'▼'} BIG ${dir.toUpperCase()} ${mag.toFixed(1)}x forming!`,level:dir==='bull'?'success':'danger',dir,magnitude:mag,volRatio:vr};
    return{...def,magnitude:mag,volRatio:vr};
}
function candlePatterns(d,settings){
    const markers=[]; if(!settings||!settings.master)return markers;
    const{n,times,opens,highs,lows,closes}=d; if(n<10)return markers;
    let lastI=-5;
    for(let i=5;i<n;i++){
        if(i-lastI<4)continue;
        const body=Math.abs(closes[i]-opens[i]),tr=highs[i]-lows[i];
        if(tr===0)continue;
        const uW=highs[i]-Math.max(opens[i],closes[i]),lW=Math.min(opens[i],closes[i])-lows[i];
        let iSL=true,iSH=true;
        const fm=Math.max(0,i-4),to=Math.min(n-1,i+2);
        for(let j=fm;j<=to;j++){if(j===i)continue;if(lows[j]<lows[i])iSL=false;if(highs[j]>highs[i])iSH=false;}
        const cT=times[i];
        if(settings.hammer){
            if(iSL&&lW>=body*2.5&&uW<=body*0.5&&body>tr*0.1){markers.push({time:cT,position:'belowBar',color:'#089981',shape:'arrowUp',text:'🔨 Hammer',size:1});lastI=i;continue;}
            if(iSH&&uW>=body*2.5&&lW<=body*0.5&&body>tr*0.1){markers.push({time:cT,position:'aboveBar',color:'#f23645',shape:'arrowDown',text:'💫 Shooting Star',size:1});lastI=i;continue;}
        }
        if(settings.engulfing){
            if(iSL&&closes[i-1]<opens[i-1]&&closes[i]>opens[i]&&closes[i]>opens[i-1]&&opens[i]<closes[i-1]){markers.push({time:cT,position:'belowBar',color:'#089981',shape:'arrowUp',text:'🐂 Bull Engulf',size:1});lastI=i;continue;}
            if(iSH&&closes[i-1]>opens[i-1]&&closes[i]<opens[i]&&closes[i]<opens[i-1]&&opens[i]>closes[i-1]){markers.push({time:cT,position:'aboveBar',color:'#f23645',shape:'arrowDown',text:'🐻 Bear Engulf',size:1});lastI=i;continue;}
        }
    }
    return markers;
}
function closingTrap(d,tf){
    const nowIST=new Date(Date.now()+5.5*3600*1000),t=nowIST.getUTCHours()*60+nowIST.getUTCMinutes();
    const inW=t>=(15*60+15)&&t<=(15*60+30),nearE=t>=(14*60+45)&&t<(15*60+15);
    if(tf==='D'||tf==='60')return{trap:false,active:false,label:'N/A',level:'muted',direction:null};
    const{n,closes,vols}=d;
    if(n<10)return{trap:false,active:inW,label:inW?'WATCHING':'-',level:'muted',direction:null};
    let v10=0; for(let i=n-10;i<n;i++)v10+=vols[i]; v10/=10;
    const d10=closes[n-1]-closes[n-10],d3=closes[n-1]-closes[n-3];
    let trap=false,dir=null;
    if(inW){
        if(d10>0&&d3<-Math.abs(d10)*0.35&&vols[n-1]<v10*0.9){trap=true;dir='bear';}
        else if(d10<0&&d3>Math.abs(d10)*0.35&&vols[n-1]<v10*0.9){trap=true;dir='bull';}
    }
    let label,level;
    if(trap){label=dir==='bear'?'SELL TRAP':'BUY TRAP';level=dir==='bear'?'danger':'success';}
    else if(inW){label='WATCHING';level='warning';}
    else if(nearE){label='APPROACHING';level='muted';}
    else{label='INACTIVE (3:15-3:30 PM IST)';level='muted';}
    return{trap,active:inW,label,level,direction:dir};
}
function divergences(d){
    const out={detected:false,label:'⚪ NONE',level:'muted',direction:null,details:null};
    const{n,highs,lows,closes}=d; if(n<30)return out;
    const rsi=rsiArr(closes,14),look=Math.min(60,n),start=n-look;
    const pL=[],pH=[];
    for(let i=start+3;i<n-2;i++){
        let iLL=true,iHH=true;
        for(let j=1;j<=3;j++){if(lows[i]>=lows[i-j]||lows[i]>=lows[i+j])iLL=false;if(highs[i]<=highs[i-j]||highs[i]<=highs[i+j])iHH=false;}
        if(iLL&&isFinite(rsi[i]))pL.push({i,price:lows[i],rsi:rsi[i]});
        if(iHH&&isFinite(rsi[i]))pH.push({i,price:highs[i],rsi:rsi[i]});
    }
    if(pL.length>=2){const prev=pL[pL.length-2],cur=pL[pL.length-1];if(cur.price<prev.price&&cur.rsi>prev.rsi+2)return{detected:true,label:'🟢 BULL DIV',level:'success',direction:'bullish',details:{prev,cur}};}
    if(pH.length>=2){const prev=pH[pH.length-2],cur=pH[pH.length-1];if(cur.price>prev.price&&cur.rsi<prev.rsi-2)return{detected:true,label:'🔴 BEAR DIV',level:'danger',direction:'bearish',details:{prev,cur}};}
    return out;
}
function doubleBottom(d){
    const{n,highs,lows,closes}=d; if(n<40)return{detected:false,pattern:null,label:'—',level:'muted'};
    const look=Math.min(60,n-3),lA=[];
    for(let i=n-2;i>=n-look;i--){
        const wL=3,wR=Math.min(3,n-1-i); if(wR<1)continue;
        let ok=true;
        for(let j=1;j<=wL&&ok;j++)if(i-j<0||lows[i]>=lows[i-j])ok=false;
        for(let j=1;j<=wR&&ok;j++)if(lows[i]>=lows[i+j])ok=false;
        if(ok)lA.push({i,val:lows[i]});
        if(lA.length>=4)break;
    }
    lA.sort((a,b)=>a.i-b.i);
    for(let a=0;a<lA.length-1;a++)for(let b=a+1;b<lA.length;b++){
        const A=lA[a],B=lA[b];
        if(B.i-A.i<5||B.i-A.i>35)continue;
        if(Math.abs(A.val-B.val)/Math.min(A.val,B.val)>0.025)continue;
        let nl=-Infinity; for(let k=A.i;k<=B.i;k++)if(highs[k]>nl)nl=highs[k];
        if(nl<Math.max(A.val,B.val)*1.02)continue;
        let conf=false; for(let k=B.i;k<n;k++)if(closes[k]>=nl){conf=true;break;}
        const near=closes[n-1]>=nl*0.99;
        if(conf||near)return{detected:true,pattern:'DOUBLE BOTTOM',label:'🟢 W-BOTTOM',level:'success',target:nl+(nl-Math.min(A.val,B.val))};
    }
    return{detected:false,pattern:null,label:'⚪ NONE',level:'muted'};
}
function flagPattern(d){
    const{n,highs,lows,closes}=d; if(n<30)return{detected:false,label:'—',level:'muted',dir:null};
    const atrA=rmaATR(highs,lows,closes,14),curAtr=atrA[n-1];
    if(!curAtr||curAtr<=0)return{detected:false,label:'⚪ NONE',level:'muted',dir:null};
    for(let impLen=4;impLen<=9;impLen++){
        const start=n-1-impLen-12; if(start<1)continue;
        const iE=start+impLen,move=closes[iE]-closes[start];
        if(Math.abs(move)/curAtr<2.5)continue;
        const dir=move>0?'bull':'bear',cLen=n-iE;
        if(cLen<3||cLen>12)continue;
        let cH=-Infinity,cL=Infinity;
        for(let i=iE;i<n;i++){if(highs[i]>cH)cH=highs[i];if(lows[i]<cL)cL=lows[i];}
        if((cH-cL)/curAtr>2.5)continue;
        if(dir==='bull'&&closes[n-1]>=cH)return{detected:true,label:'🚩 BULL FLAG BREAKOUT',level:'success',dir};
        if(dir==='bear'&&closes[n-1]<=cL)return{detected:true,label:'🚩 BEAR FLAG BREAKDOWN',level:'danger',dir};
        return{detected:true,label:dir==='bull'?'🟡 BULL FLAG FORMING':'🟡 BEAR FLAG FORMING',level:'warning',dir};
    }
    return{detected:false,label:'⚪ NONE',level:'muted',dir:null};
}

/* ========== BATCH B ENGINES ========== */
function evalMasterPro(d){
    const{n,highs,lows,closes,vols}=d;
    if(n<30)return{squeeze:{active:false,label:'—',level:'muted'},vsa:{label:'—',level:'muted'},macd:{label:'—',level:'muted'},rsi:{label:'—',level:'muted'},score:0};
    const sma20=smaArr(closes,20),atr20=rmaATR(highs,lows,closes,20),c=n-1;
    let sSq=0; for(let i=c-19;i<=c;i++){const df=closes[i]-sma20[c];sSq+=df*df;}
    const sd=Math.sqrt(sSq/20),bbU=sma20[c]+2*sd,bbL=sma20[c]-2*sd;
    const kcU=sma20[c]+1.5*atr20[c],kcL=sma20[c]-1.5*atr20[c];
    const sqA=bbU<=kcU&&bbL>=kcL;
    let vS=0; for(let i=c-19;i<=c;i++)vS+=vols[i];
    const avgV=vS/20,vR=vols[c]/Math.max(avgV,1);
    const body=Math.abs(closes[c]-opens_in(d,c)),rng=Math.max(highs[c]-lows[c],1e-9),cLoc=(closes[c]-lows[c])/rng;
    let vLab='NORMAL VOLUME',vLev='muted';
    if(vR>=1.8&&cLoc>0.75){vLab='🔥 CLIMACTIC BUYING';vLev='success';}
    else if(vR>=1.8&&cLoc<0.25){vLab='💥 CLIMACTIC SELLING';vLev='danger';}
    else if(vR>=1.5&&cLoc>0.6&&body<rng*0.4){vLab='🧽 ABSORPTION';vLev='info';}
    else if(vR<=0.6){vLab='🧊 LOW VOL / DRY-UP';vLev='warning';}
    const mo=macdHist(closes),h=mo.hist[c],hP=mo.hist[c-1];
    let mL='NEUTRAL',mLev='muted';
    if(h>0&&h>hP){mL='🟢 BULL ACCEL';mLev='success';}else if(h<0&&h<hP){mL='🔴 BEAR ACCEL';mLev='danger';}
    const rA=rsiArr(closes,14),rv=rA[c];
    let rLab='NEUTRAL',rLev='muted';
    if(rv>=70){rLab='🔥 OVERBOUGHT';rLev='danger';}else if(rv<=30){rLab='🧊 OVERSOLD';rLev='success';}
    return{squeeze:{active:sqA,label:sqA?'⚡ TRUE SQUEEZE':'🌋 EXPANSION',level:sqA?'warning':'info'},vsa:{label:vLab,level:vLev},macd:{label:mL,level:mLev},rsi:{label:rLab,level:rLev,value:+rv.toFixed(1)},score:(vLev==='success'?1:0)+(mLev==='success'?1:0)};
}
// helper for opens (MasterPro uses opens[] which is in d as opens array)
function opens_in(d,i){return d.opens[i];}

function evalNextCandle(d){
    const{n,times,highs,lows,closes,vols}=d;
    if(n<25)return{direction:'neutral',score:0,confidence:'low',factors:['Insufficient data']};
    const c=n-1;let score=0;const factors=[];
    const ema20=emaArr(closes,20),ema50=emaArr(closes,50);
    if(closes[c]>ema20[c]&&ema20[c]>ema50[c]){score+=20;factors.push('EMA20 > EMA50 Bullish');}
    else if(closes[c]<ema20[c]&&ema20[c]<ema50[c]){score-=20;factors.push('EMA20 < EMA50 Bearish');}
    const rA=rsiArr(closes,14),r=rA[c];
    if(isFinite(r)){if(r<30){score+=12;factors.push(`RSI Oversold (${r.toFixed(0)})`);}else if(r>70){score-=12;factors.push(`RSI Overbought (${r.toFixed(0)})`);}}
    const vwA=vwapSession(times,highs,lows,closes,vols),vw=vwA[c];
    if(closes[c]>vw){score+=10;factors.push('Above Session VWAP');}else{score-=10;factors.push('Below Session VWAP');}
    score=Math.max(-100,Math.min(100,score));
    const dir=score>=20?'bull':score<=-20?'bear':'neutral';
    const conf=Math.abs(score)>=45?'high':Math.abs(score)>=25?'med':'low';
    return{direction:dir,score,confidence:conf,factors:factors.slice(0,4)};
}
function evalOrderFlow(d){
    const{n,highs,lows,closes,vols}=d;
    if(n<25)return{detected:false,label:'—',level:'muted',signals:[]};
    let vS=0; for(let i=n-20;i<n;i++)vS+=vols[i];
    const avgV=vS/20;
    if(avgV<100)return{detected:false,label:'⚪ NO VOLUME DATA',level:'muted',signals:[]};
    const signals=[];
    for(let i=Math.max(20,n-5);i<n;i++){
        const body=Math.abs(closes[i]-opens_in(d,i)),rng=Math.max(highs[i]-lows[i],1e-9),vr=vols[i]/avgV;
        if(vr>1.8&&body/rng<0.25)signals.push({i,type:'ABSORPTION',text:closes[i]>=opens_in(d,i)?'🧽 BUY ABSORPTION':'🧽 SELL ABSORPTION',level:'success'});
    }
    return{detected:signals.length>0,label:signals.length?signals[signals.length-1].text:'⚪ NONE',signals};
}
function evalPreMarket(d){
    const{n,highs,lows,closes}=d;
    if(n<1)return null;
    const h=highs[n-1],l=lows[n-1],c=closes[n-1];
    const p=(h+l+c)/3,bc=(h+l)/2,tc=(p-bc)+p;
    return{pivot:+p.toFixed(2),bc:+bc.toFixed(2),tc:+tc.toFixed(2),r1:+(2*p-l).toFixed(2),s1:+(2*p-h).toFixed(2),cprWidth:+Math.abs(tc-bc).toFixed(2)};
}
function evalTradePlan(d,cap=100000,riskP=0.01){
    const{n,highs,lows,closes}=d;
    if(n<30)return{ready:false,reason:'Insufficient data'};
    const ltp=closes[n-1],atrA=rmaATR(highs,lows,closes,14),atr=atrA[n-1];
    if(!atr||atr<=0)return{ready:false,reason:'ATR Zero'};
    const ema20=emaArr(closes,20)[n-1],isBull=ltp>=ema20;
    const sl=isBull?ltp-1.5*atr:ltp+1.5*atr;
    const t1=isBull?ltp+1.5*atr:ltp-1.5*atr;
    const t2=isBull?ltp+3.0*atr:ltp-3.0*atr;
    const risk=Math.abs(ltp-sl),qty=risk>0?Math.floor((cap*riskP)/risk):0;
    return{ready:true,direction:isBull?'LONG':'SHORT',entry:+ltp.toFixed(2),sl:+sl.toFixed(2),t1:+t1.toFixed(2),t2:+t2.toFixed(2),risk_per_share:+risk.toFixed(2),qty_at_risk:qty,verdict:'✅ High Probability Plan (1:2 RR)'};
}
function evalTrendBias(d){
    const{n,times,highs,lows,closes,vols}=d;
    if(n<30)return{score:0,label:'NEUTRAL',level:'muted',bias:'neutral'};
    const c=n-1,e20=emaArr(closes,20)[c],e50=emaArr(closes,50)[c],vw=vwapSession(times,highs,lows,closes,vols)[c];
    const rs=rsiArr(closes,14)[c];
    let sc=0;
    if(closes[c]>=vw)sc+=1;else sc-=1;
    if(e20>e50)sc+=1;else sc-=1;
    if(isFinite(rs)&&rs>50)sc+=1;else sc-=1;
    const lab=sc>=2?'🟢 STRONG LONG':sc<=-2?'🔴 STRONG SHORT':'⚪ NEUTRAL / CHOP';
    const lev=sc>=2?'success':sc<=-2?'danger':'muted';
    const bias=sc>=2?'bull':sc<=-2?'bear':'neutral';
    return{score:sc,label:lab,level:lev,bias};
}
function evalVCP(d){
    const{n,highs,lows,closes}=d;
    if(n<60)return{detected:false,label:'INSUFF DATA',level:'muted'};
    const atrA=rmaATR(highs,lows,closes,14),curA=atrA[n-1],tight=(curA/closes[n-1])<0.02;
    if(tight)return{detected:true,label:'🟢 VALID VCP COIL',level:'success',buyPoint:+(highs[n-1]+0.05).toFixed(2)};
    return{detected:false,label:'⚪ NO VCP',level:'muted'};
}
function evalGreeks(spot,strike,type='CE',ivPct=18,dte=7,r=6.75){
    const S=Number(spot)||0,K=Number(strike)||0,sigma=(Number(ivPct)||18)/100,T=Math.max(Number(dte)||1,1e-6)/365,R=(Number(r)||6.75)/100;
    if(S<=0||K<=0)return{delta:0,gamma:0,theta:0,vega:0,price:0};
    const sqrtT=Math.sqrt(T),d1=(Math.log(S/K)+(R+0.5*sigma*sigma)*T)/(sigma*sqrtT),d2=d1-sigma*sqrtT;
    const npdf=x=>Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI);
    const ncdf=x=>{const t=1/(1+0.2316419*Math.abs(x));const poly=t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));const c=1-npdf(Math.abs(x))*poly;return x>=0?c:1-c;};
    let delta,price;
    if(type==='PE'){delta=ncdf(d1)-1;price=K*Math.exp(-R*T)*ncdf(-d2)-S*ncdf(-d1);}
    else{delta=ncdf(d1);price=S*ncdf(d1)-K*Math.exp(-R*T)*ncdf(d2);}
    const gamma=npdf(d1)/(S*sigma*sqrtT),vega=(S*npdf(d1)*sqrtT)/100;
    return{delta:+delta.toFixed(4),gamma:+gamma.toFixed(6),vega:+vega.toFixed(2),price:+price.toFixed(2)};
}

/* ========== MESSAGE ROUTER ========== */
self.onmessage=e=>{
    const msg=e.data; if(!msg||msg.type!=='analyze')return;
    try{
        const d=unpack(msg.payload),tf=msg.tf||'15';
        const settings={master:true,hammer:true,engulfing:true,star:true,doji:true};
        const greeksOpt=msg.opts&&msg.opts.greeks;
        const result={
            checklist:evalChecklist(d),breakout:scanBreakout(d),bigCandle:bigCandle(d,tf),
            patterns:candlePatterns(d,settings),closingTrap:closingTrap(d,tf),
            divergence:divergences(d),doubleBottom:doubleBottom(d),flag:flagPattern(d),
            masterPro:evalMasterPro(d),nextCandle:evalNextCandle(d),orderFlow:evalOrderFlow(d),
            pivots:evalPreMarket(d),
            tradePlan:evalTradePlan(d,msg.opts?.capital,msg.opts?.riskPct),
            trendBias:evalTrendBias(d),vcp:evalVCP(d),
            greeks:greeksOpt?evalGreeks(greeksOpt.spot,greeksOpt.strike,greeksOpt.type,greeksOpt.iv,greeksOpt.dte):null,
            meta:{n:d.n,tf,symbol:msg.symbol||'',ts:Date.now()}
        };
        self.postMessage({type:'result',id:msg.id,result});
    }catch(err){self.postMessage({type:'result',id:msg.id,result:null,error:String(err)});}
};
