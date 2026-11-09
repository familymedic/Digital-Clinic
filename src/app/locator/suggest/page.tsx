import { Suspense } from "react";
import SuggestForm from "./SuggestForm";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SuggestForm />
    </Suspense>
  );
}
