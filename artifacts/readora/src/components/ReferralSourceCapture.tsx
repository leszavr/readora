import { useEffect } from "react";
import { captureReferralSource } from "@/lib/referral-source";

export function ReferralSourceCapture() {
  useEffect(() => {
    captureReferralSource();
  }, []);

  return null;
}
