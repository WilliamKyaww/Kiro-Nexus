export function PlaceholderPage({ title, body }: { title: string; body: string }) {
  return (
    <section className="page" aria-labelledby="ph-h">
      <h1 id="ph-h">{title}</h1>
      <p>{body}</p>
    </section>
  );
}
