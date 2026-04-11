import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
const c = new SuiClient({ url: getFullnodeUrl('mainnet') });
const POOL = '0xf410d3750a32b8039fa72acb23b1c9ae7c2665e76e5f52b87585797f185c5f2f';
(async () => {
  const obj = await c.getObject({ id: POOL, options: { showContent: true, showOwner: true } });
  console.log('Owner:', JSON.stringify(obj.data?.owner));
  const content = obj.data?.content as any;
  if (content?.fields) {
    const f = content.fields;
    console.log('total_nav:', f.total_nav);
    console.log('total_shares:', f.total_shares);
    console.log('share_price:', f.share_price);
    console.log('treasury:', f.treasury);
    console.log('management_fee_bps:', f.management_fee_bps);
    console.log('performance_fee_bps:', f.performance_fee_bps);
    console.log('is_paused:', f.is_paused);
    console.log('member_count:', f.member_count);
  } else {
    console.log('Full object:', JSON.stringify(obj, null, 2));
  }
})();
