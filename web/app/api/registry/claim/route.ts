/**
 * Dev báo lại đã claim Grant.
 *
 *   POST /api/registry/claim   ghi nhận sau khi issueGrant đã confirm
 *   GET  /api/registry/claim   danh sách claim (lọc theo ?campaignId=)
 *
 * 🔴 Route này KHÔNG phát Grant và không giữ tiền. Nó đọc `grantOf(projectId)`
 * trên chain rồi mới ghi — client nói dối thì chain không xác nhận, và không
 * có hàng nào được tạo. Registry offline cũng không ảnh hưởng Grant đã phát.
 */

import { NextResponse } from 'next/server';
import { DEFAULT_CHAIN_ID, getNetwork } from '../../../../../src/config.js';
import { ChainGrantSource } from '../../../../../src/grant.js';
import { listClaims, saveClaim, registryStoreMode } from '../../../../lib/registry-store';

export const dynamic = 'force-dynamic';

const isBytes32 = (v: unknown) => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);
const isAddress = (v: unknown) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const { campaignId, projectId } = body ?? {};
  if (!isBytes32(projectId)) return NextResponse.json({ error: 'projectId must be a bytes32 value.' }, { status: 400 });
  if (!isBytes32(campaignId)) return NextResponse.json({ error: 'campaignId must be a bytes32 value.' }, { status: 400 });

  try {
    const chainId = Number(body.chainId ?? DEFAULT_CHAIN_ID);
    const grantManager = (process.env.GRANT_MANAGER ?? getNetwork(chainId).grantManager) as `0x${string}` | undefined;
    if (!grantManager) return NextResponse.json({ error: `No GrantManager is deployed for chain ${chainId}.` }, { status: 400 });

    const grant = await new ChainGrantSource(grantManager, chainId).get(projectId);
    if (!grant) {
      return NextResponse.json(
        { error: 'No Grant exists on-chain for this project. Claim it first; nothing was recorded.' },
        { status: 409 },
      );
    }
    if (body.grantId && String(body.grantId) !== grant.grantId) {
      return NextResponse.json({ error: 'grantId does not match the on-chain Grant.', onChainGrantId: grant.grantId }, { status: 409 });
    }

    // owner không đọc được từ grantOf(); signer thì có, nên nó là thứ được đối chiếu.
    if (isAddress(body.signer) && body.signer.toLowerCase() !== grant.signer.toLowerCase()) {
      return NextResponse.json({ error: 'signer does not match the on-chain Grant signer.', onChainSigner: grant.signer }, { status: 409 });
    }

    await saveClaim({
      projectId,
      campaignId,
      chainId,
      grantId: grant.grantId,
      owner: isAddress(body.owner) ? body.owner : grant.signer,
      signer: grant.signer,
      tx: typeof body.transaction === 'string' ? body.transaction : undefined,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      grantId: grant.grantId,
      // Số đã vest ngay lúc claim — phần dev tiêu được trước khi cần claimTranche.
      released: grant.released.toString(),
      total: grant.total.toString(),
      perTxCap: grant.perTxCap.toString(),
      dailyCap: grant.dailyCap.toString(),
      expiry: grant.expiry,
      allowedPayTo: grant.allowedPayTo,
      storage: registryStoreMode,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.shortMessage ?? e?.message ?? String(e) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const campaignId = new URL(request.url).searchParams.get('campaignId') ?? undefined;
  try {
    return NextResponse.json({ claims: await listClaims(campaignId), storage: registryStoreMode });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
