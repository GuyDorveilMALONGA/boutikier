import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QrCode } from "lucide-react";
import { api } from "../lib/api";
import { visibleLiveQuery } from "../lib/live-query";

export function ShopQrCard({ shopName }: { shopName: string }) {
  const qrQuery = useQuery({
    queryKey: ["shop-qr"],
    queryFn: api.shopQr,
    retry: 2,
    ...visibleLiveQuery,
  });
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    if (!qrQuery.data) return;
    let active = true;
    void import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(
        `${window.location.origin}${qrQuery.data.path}`,
        { errorCorrectionLevel: "H", margin: 2, width: 196 },
      ))
      .then((next) => { if (active) setImage(next); });
    return () => { active = false; };
  }, [qrQuery.data]);

  return <section className="carnet-qr-card" aria-label={`QR de ${shopName}`}>
    <div className="carnet-qr-heading">
      <span><QrCode size={18} /></span>
      <div><strong>QR de la boutique</strong><small>Permanent et révocable</small></div>
    </div>
    {qrQuery.error ? <div className="qr-error">QR momentanément indisponible.</div> : qrQuery.isLoading || !image ? <div className="qr-loading"><span />Préparation du QR…</div> : <img src={image} alt={`QR permanent de ${shopName}`} />}
    <strong className="carnet-qr-name">{shopName}</strong>
    <small>Le client scanne ce code pour vous identifier.</small>
  </section>;
}
