export default function Room() {
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ flex: 3, borderRight: '1px solid #ccc' }}>
        <h2>화상/음성 영역</h2>
      </div>
      <div style={{ flex: 1, padding: '10px' }}>
        <h2>회의록 보관함</h2>
        <p>실시간 메모 작성 영역</p>
      </div>
    </div>
  );
}