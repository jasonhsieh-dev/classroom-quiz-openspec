export function App() {
  return (
    <main className="shell">
      <p className="eyebrow">Classroom Buzzer</p>
      <h1>課堂搶答系統</h1>
      <p>專案基礎環境已就緒。老師與學生功能將依 OpenSpec 後續階段實作。</p>
      <div className="roles" aria-label="系統角色">
        <section>
          <h2>老師端</h2>
          <p>匯入 Guided Notes、管理活動並查看結果。</p>
        </section>
        <section>
          <h2>學生端</h2>
          <p>選擇組別後，依活動狀態進行作答。</p>
        </section>
      </div>
    </main>
  );
}
