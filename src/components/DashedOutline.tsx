// Exact 10px-dash / 10px-gap border for "Add new" tiles, per Figma spec.
// CSS `border-style: dashed` can't guarantee a specific dash length, so this
// draws the border with an SVG rect instead. Drop it in as the first child
// of any element with the `.dashed-outline`-consuming parent set to
// `position: relative` (see `.dashed-outline` in globals.css).
export default function DashedOutline() {
  return (
    <svg className="dashed-outline" aria-hidden="true">
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        rx="8"
        ry="8"
        fill="none"
        strokeWidth="1"
        strokeDasharray="10 10"
        style={{ stroke: 'var(--border)' }}
      />
    </svg>
  );
}
