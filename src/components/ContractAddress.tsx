export const CONTRACT_ADDRESS = "0x84f6d943cea6773c025ed0c267cb52ef8a4d4f44";

export function ContractAddress() {
  return (
    <p className="min-w-0 max-w-full">
      <span className="text-[11px] uppercase tracking-[0.16em] text-mute">Contract</span>
      <span className="mt-1 block break-all text-[13px] text-ink">{CONTRACT_ADDRESS}</span>
    </p>
  );
}
