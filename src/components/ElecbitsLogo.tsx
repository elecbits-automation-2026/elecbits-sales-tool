// ============ LOGO ============
export function ElecbitsLogo({ size = "md", showTagline = false }) {
  const sizes = { sm: { text: "text-lg", tag: "text-[10px]" }, md: { text: "text-2xl", tag: "text-xs" }, lg: { text: "text-4xl", tag: "text-sm" } };
  const s = sizes[size] || sizes.md;
  return (
    <div className="flex flex-col leading-none">
      <span className={`font-black tracking-tight text-blue-700 ${s.text}`} style={{ fontFamily: "system-ui, -apple-system, sans-serif", letterSpacing: "-0.02em" }}>Elecbits</span>
      {showTagline && <span className={`text-slate-500 font-medium mt-0.5 ${s.tag}`}>Sales OS</span>}
    </div>
  );
}
