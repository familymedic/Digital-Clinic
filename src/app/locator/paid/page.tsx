import { Suspense } from "react";
import PaidReturn from "./PaidReturn";

export const metadata = { title: "Locator payment", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PaidReturn />
    </Suspense>
  );
}
