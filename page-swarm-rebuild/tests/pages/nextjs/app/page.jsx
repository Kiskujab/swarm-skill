import Counter from './Counter';

const services = [
  ['Bookkeeping', 'Monthly books, bank reconciliation and receipts handled for you.'],
  ['Payroll', 'Salaries, payslips and filings on time, every month.'],
  ['Tax returns', 'Company and personal returns prepared and checked twice.'],
  ['Advisory', 'Quarterly reviews with plain-language numbers and next steps.']
];
const steps = [
  ['01', 'Intro call', 'A free 20-minute call to understand your business.'],
  ['02', 'Proposal', 'A fixed monthly price, in writing, before we start.'],
  ['03', 'Onboarding', 'We connect your bank and collect last year’s documents.'],
  ['04', 'Every month', 'You send receipts, we send a one-page summary.']
];

export default function Page() {
  return (
    <>
      <header className="top">
        <div className="wrap row">
          <strong className="logo">Northwind Ledger</strong>
          <nav>
            <a href="#services">Services</a>
            <a href="#how">How it works</a>
            <a href="#contact">Contact</a>
          </nav>
        </div>
      </header>
      <main>
        <section className="hero">
          <div className="wrap">
            <p className="eyebrow">Accounting for small companies</p>
            <h1>Calm numbers for busy owners</h1>
            <p className="lead">Fictional accounting office used to test the swarm effect on a hydrated Next.js page.</p>
            <Counter />
          </div>
        </section>
        <section id="services">
          <div className="wrap">
            <h2>Services</h2>
            <div className="grid">
              {services.map(([t, d]) => (
                <article className="card" key={t}><h3>{t}</h3><p>{d}</p></article>
              ))}
            </div>
          </div>
        </section>
        <section id="how">
          <div className="wrap">
            <h2>How it works</h2>
            <ol className="steps">
              {steps.map(([n, t, d]) => (
                <li key={n}><span>{n}</span><b>{t}</b><p>{d}</p></li>
              ))}
            </ol>
          </div>
        </section>
        <section id="contact">
          <div className="wrap">
            <h2>Contact</h2>
            <p>Phone: <a href="tel:+15550100300">+1 555 0100 300</a></p>
            <p>Email: <a href="mailto:office@northwind-ledger.example">office@northwind-ledger.example</a></p>
          </div>
        </section>
      </main>
      <footer><div className="wrap">Northwind Ledger (fictional test app)</div></footer>
    </>
  );
}
