import { useNavigate, useLocation } from 'react-router-dom';

/**
 * 등록되지 않은 경로로 들어왔을 때 보여줍니다.
 * 이게 없으면 라우트가 안 맞을 때 흰 화면만 뜨고 원인을 알 수 없습니다.
 */
export default function NotFound() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🧭</div>
        <h2 style={{ marginBottom: 8 }}>페이지를 찾을 수 없어요</h2>
        <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
          <code>{pathname}</code> 에 연결된 화면이 없습니다.
        </p>
        <button
          type="button"
          onClick={() => navigate('/main')}
          style={{
            padding: '10px 20px',
            background: '#1d9e75',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          내 그룹으로 돌아가기
        </button>
      </div>
    </div>
  );
}
