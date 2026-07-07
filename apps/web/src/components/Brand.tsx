import { useTranslation } from "react-i18next";

export function Brand({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={`font-semibold tracking-tight text-content ${className}`}>{t("app.name")}</span>
  );
}
