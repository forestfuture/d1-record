// The d1-record logo: small beside the site's name in the header, large on the home page. The
// mark is public/logo.svg, which blume.config.ts's `logo` also shows in the 404 page's header;
// replace that file to change it everywhere.
import mark from "../public/logo.svg?raw";

const sizes = { sm: 20, lg: 40 } as const;

export default function Logo({ size }: { size: keyof typeof sizes }) {
  const pixels = sizes[size];
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 [&>svg]:size-full"
      style={{ width: pixels, height: pixels }}
      dangerouslySetInnerHTML={{ __html: mark }}
    />
  );
}
