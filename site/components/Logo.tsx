// The d1-record logo: small beside the site's name in the header, large on the home page.
// Replace the SVG's contents to change the mark; both sizes draw it in a 40 × 40 box.

const sizes = { sm: 20, lg: 40 } as const;

export default function Logo({ size }: { size: keyof typeof sizes }) {
  const pixels = sizes[size];
  return (
    <svg aria-hidden="true" width={pixels} height={pixels} viewBox="0 0 40 40" className="shrink-0">
      <circle cx="20" cy="20" r="20" fill="#3f3f46" />
    </svg>
  );
}
