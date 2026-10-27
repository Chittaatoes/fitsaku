// The sharpening filter behind "HD sharpening" (Settings > Exercise animations). The built-in pictures
// are 180 px and are shown larger, so the browser's smooth upscaling softens them. A light unsharp
// kernel (centre-weighted, sums to 1) restores edges on the large still, and CSS (index.css,
// [data-media-hd]) adds a little contrast and colour to the stills and the clips. Never applied to the
// small list thumbnails (they are shown smaller than their size and a filter on hundreds of them
// would cost scrolling more than it gives).
export default function MediaFilters() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <filter id="fs-sharpen" colorInterpolationFilters="sRGB">
        <feConvolveMatrix order="3" kernelMatrix="0 -0.55 0  -0.55 3.2 -0.55  0 -0.55 0" divisor="1" preserveAlpha="true" />
      </filter>
    </svg>
  )
}
