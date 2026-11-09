import ManageView from "./ManageView";

export const metadata = { title: "Your Locator listing", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ManageView token={token} />;
}
