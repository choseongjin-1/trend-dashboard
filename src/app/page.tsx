import { Suspense } from "react";
import { HomeClient } from "./HomeClient";

// HomeClient uses useSearchParams (for the deep-linkable keyword detail
// modal), which requires a Suspense boundary around it — otherwise a static
// production build fails. See Next's useSearchParams docs.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <HomeClient />
    </Suspense>
  );
}
