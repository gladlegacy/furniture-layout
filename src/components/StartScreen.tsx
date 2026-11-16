type WorkMode = 'furniture' | 'unit'

export function StartScreen({ onChoose }: { onChoose: (mode: WorkMode) => void }) {
  return (
    <section className="start">
      <FloorDrawing />
      <div className="start-panel">
        <h1>시작할 작업을 고르세요</h1>
        <p>가구를 놓거나, 평면 시안을 만듭니다.</p>
        <div className="start-choices">
          <button type="button" onClick={() => onChoose('furniture')}>
            <strong>가구 배치</strong>
            <span>방 모양과 문, 창문을 정하고 가구를 놓습니다.</span>
          </button>
          <button type="button" onClick={() => onChoose('unit')}>
            <strong>평면 시안</strong>
            <span>칸을 옮기고 가로와 세로를 바꿉니다.</span>
          </button>
        </div>
      </div>
    </section>
  )
}

function FloorDrawing() {
  return (
    <svg className="start-art" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect x="70" y="48" width="560" height="360" fill="#e6d8c8" />
      <rect x="630" y="48" width="300" height="250" fill="#d5e2e8" />
      <rect x="930" y="48" width="440" height="390" fill="#ddd4c8" />
      <rect x="70" y="408" width="860" height="444" fill="#eadccb" />
      <rect x="930" y="438" width="440" height="414" fill="#e4ddd2" />

      <rect x="210" y="560" width="420" height="230" rx="6" fill="#d5deee" />
      <rect x="250" y="600" width="300" height="78" rx="8" fill="#c5d2e6" stroke="#3d5a80" strokeWidth="2" />
      <rect x="268" y="612" width="70" height="22" rx="6" fill="#f4f7fb" />
      <rect x="348" y="612" width="70" height="22" rx="6" fill="#f4f7fb" />
      <rect x="430" y="612" width="96" height="22" rx="6" fill="#f4f7fb" />
      <rect x="318" y="700" width="180" height="64" rx="4" fill="#f3efe8" stroke="#3d5a80" strokeWidth="2" />
      <rect x="660" y="640" width="86" height="86" rx="8" fill="#c5d2e6" stroke="#3d5a80" strokeWidth="2" />
      <circle cx="790" cy="760" r="28" fill="#e7eef6" stroke="#3d5a80" strokeWidth="2" />
      <path d="M790 742c8 10 8 18 0 28M778 754h24" fill="none" stroke="#5f7d68" strokeWidth="2" />
      <circle cx="150" cy="760" r="22" fill="#e7eef6" stroke="#3d5a80" strokeWidth="2" />
      <path d="M150 746c6 8 6 14 0 22M141 756h18" fill="none" stroke="#5f7d68" strokeWidth="2" />

      <rect x="150" y="110" width="250" height="210" rx="4" fill="#f7f5f1" stroke="#3d5a80" strokeWidth="2" />
      <rect x="150" y="110" width="250" height="28" fill="#d7e0ee" />
      <rect x="176" y="122" width="78" height="36" rx="8" fill="#f4f7fb" stroke="#3d5a80" strokeWidth="1.5" />
      <rect x="292" y="122" width="78" height="36" rx="8" fill="#f4f7fb" stroke="#3d5a80" strokeWidth="1.5" />
      <rect x="420" y="130" width="54" height="46" rx="3" fill="#f3efe8" stroke="#3d5a80" strokeWidth="2" />
      <rect x="110" y="340" width="280" height="48" fill="#efe8df" stroke="#3d5a80" strokeWidth="2" />

      <rect x="670" y="86" width="220" height="84" rx="18" fill="#f4f8fa" stroke="#3d5a80" strokeWidth="2" />
      <ellipse cx="700" cy="250" rx="26" ry="18" fill="#f4f8fa" stroke="#3d5a80" strokeWidth="2" />
      <rect x="820" y="210" width="48" height="70" rx="16" fill="#f4f8fa" stroke="#3d5a80" strokeWidth="2" />

      <rect x="960" y="70" width="390" height="36" fill="#efe8df" stroke="#3d5a80" strokeWidth="2" />
      <circle cx="1040" cy="88" r="8" fill="none" stroke="#3d5a80" strokeWidth="2" />
      <circle cx="1100" cy="88" r="8" fill="none" stroke="#3d5a80" strokeWidth="2" />
      <circle cx="1160" cy="88" r="8" fill="none" stroke="#3d5a80" strokeWidth="2" />
      <rect x="1280" y="70" width="70" height="150" fill="#efe8df" stroke="#3d5a80" strokeWidth="2" />
      <rect x="1020" y="180" width="150" height="100" fill="#f3efe8" stroke="#3d5a80" strokeWidth="2" />
      <rect x="990" y="200" width="22" height="60" rx="4" fill="#e7eef6" stroke="#3d5a80" strokeWidth="1.5" />
      <rect x="1178" y="200" width="22" height="60" rx="4" fill="#e7eef6" stroke="#3d5a80" strokeWidth="1.5" />
      <rect x="1044" y="154" width="100" height="20" rx="4" fill="#e7eef6" stroke="#3d5a80" strokeWidth="1.5" />
      <rect x="1044" y="286" width="100" height="20" rx="4" fill="#e7eef6" stroke="#3d5a80" strokeWidth="1.5" />

      <rect x="990" y="690" width="200" height="36" fill="#efe8df" stroke="#3d5a80" strokeWidth="2" />
      <circle cx="1240" cy="640" r="26" fill="#e7eef6" stroke="#3d5a80" strokeWidth="2" />
      <path d="M1240 622c8 10 8 18 0 28M1228 634h24" fill="none" stroke="#5f7d68" strokeWidth="2" />

      <g fill="none" stroke="#3a4452" strokeWidth="8" strokeLinecap="square">
        <path d="M70 48H1320" />
        <path d="M70 48V852" />
        <path d="M1320 48V852" />
        <path d="M70 852H1320" />
        <path d="M630 48V298" />
        <path d="M930 48V438" />
        <path d="M70 408H250" />
        <path d="M390 408H930" />
        <path d="M930 438V620" />
        <path d="M930 760V852" />
      </g>

      <g fill="none" stroke="#8ea0b5" strokeWidth="3">
        <path d="M180 48v18M460 48v18M180 66h280" />
        <path d="M1320 140h-18M1320 300h-18M1302 140v160" />
        <path d="M180 852v-18M520 852v-18M180 834h340" />
      </g>

      <path d="M250 408A70 70 0 0 0 320 338" fill="none" stroke="#3d5a80" strokeWidth="1.6" />
      <path d="M250 408h70" stroke="#3d5a80" strokeWidth="1.6" />
      <path d="M1040 760A70 70 0 0 1 1110 690" fill="none" stroke="#3d5a80" strokeWidth="1.6" />
      <path d="M1040 760h70" stroke="#3d5a80" strokeWidth="1.6" />
      <path d="M1180 852A80 80 0 0 0 1260 772" fill="none" stroke="#3d5a80" strokeWidth="1.6" />
      <path d="M1180 852h80" stroke="#3d5a80" strokeWidth="1.6" />
    </svg>
  )
}
