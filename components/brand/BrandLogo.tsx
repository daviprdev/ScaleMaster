type BrandLogoProps = {
  /** Show only the symbol (no text). Default: false */
  symbolOnly?: boolean;
  /** Size in pixels for the logo image. Default: 32 */
  size?: number;
  /** Additional classes for the wrapper */
  className?: string;
  /** Text size class when showing name. Default: "text-lg" */
  textSize?: string;
  /** Whether to show the gradient text effect on the name. Default: true */
  gradientText?: boolean;
};

/**
 * Scale Master brand logo component.
 * Uses the official logo from public/brand/scale-master-logo.jpg
 *
 * Variants:
 * - symbolOnly: just the logo image (for collapsed sidebar, icons)
 * - with text: logo + "Scale Master" name (for expanded sidebar, headers)
 */
export function BrandLogo({
  symbolOnly = false,
  size = 32,
  className = "",
  textSize = "text-lg",
  gradientText = true,
}: BrandLogoProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className="relative flex-shrink-0 rounded-lg overflow-hidden"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/scale-master-logo.jpg"
          alt="Scale Master"
          width={size}
          height={size}
          className="object-contain"
        />
      </div>
      {!symbolOnly && (
        <span
          className={`font-bold whitespace-nowrap ${textSize} ${gradientText ? "gradient-text" : "text-white"}`}
        >
          Scale Master
        </span>
      )}
    </div>
  );
}

/**
 * Compact brand logo for small spaces (favicon-like usage)
 */
export function BrandLogoCompact({
  size = 24,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`relative flex-shrink-0 rounded-md overflow-hidden ${className}`}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/scale-master-logo.jpg"
        alt="Scale Master"
        width={size}
        height={size}
        className="object-contain"
      />
    </div>
  );
}

/**
 * Large brand logo for auth screens and hero sections
 */
export function BrandLogoLarge({
  size = 64,
  showName = true,
  className = "",
}: {
  size?: number;
  showName?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-4 ${className}`}>
      <div
        className="relative rounded-xl overflow-hidden shadow-lg"
        style={{
          width: size,
          height: size,
          boxShadow: "0 0 24px rgba(0, 73, 141, 0.3)"
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/scale-master-logo.jpg"
          alt="Scale Master"
          width={size}
          height={size}
          className="object-contain"
        />
      </div>
      {showName && (
        <span className="text-2xl font-bold gradient-text">
          Scale Master
        </span>
      )}
    </div>
  );
}