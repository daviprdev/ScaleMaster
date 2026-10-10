import { ImageResponse } from "next/og";
import fs from "fs";
import path from "path";

export async function GET() {
  const logoPath = path.join(process.cwd(), "public/brand/scale-master-logo.jpg");
  const logoData = fs.readFileSync(logoPath);
  const logoBase64 = logoData.toString("base64");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#001244",
        }}
      >
        <img
          src={`data:image/jpeg;base64,${logoBase64}`}
          width={160}
          height={160}
          style={{ objectFit: "contain" }}
        />
      </div>
    ),
    { width: 192, height: 192 }
  );
}