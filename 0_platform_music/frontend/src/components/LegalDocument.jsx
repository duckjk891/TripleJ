import '../pages/LegalPage.css';

// 이용약관 / 개인정보 처리방침 공용 렌더러.
// doc = { title, effectiveDate, sections: [{ heading, paragraphs[], table?, note? }] }
export default function LegalDocument({ doc }) {
  if (!doc) {
    if (import.meta.env.DEV) console.warn('[LegalDocument] doc missing');
    return null;
  }

  return (
    <main className="legal-page">
      <div className="legal-page__inner">
        <h1 className="legal-page__title">{doc.title}</h1>
        {doc.effectiveDate && (
          <p className="legal-page__effective">시행일: {doc.effectiveDate}</p>
        )}

        {doc.sections.map((section, idx) => (
          <section className="legal-page__section" key={idx}>
            <h2 className="legal-page__heading">{section.heading}</h2>

            {(section.paragraphs || []).map((p, pIdx) => (
              <p
                key={pIdx}
                className={p.startsWith('  ') ? 'legal-page__para legal-page__para--sub' : 'legal-page__para'}
              >
                {p.trim()}
              </p>
            ))}

            {section.table && (
              <div className="legal-page__table-wrap">
                <table className="legal-page__table">
                  <thead>
                    <tr>
                      {section.table.columns.map((col, cIdx) => (
                        <th key={cIdx}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.table.rows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.map((cell, cellIdx) => (
                          <td key={cellIdx}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {section.note && <p className="legal-page__note">※ {section.note}</p>}
          </section>
        ))}
      </div>
    </main>
  );
}
