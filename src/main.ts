// 자리표시자. 단계 2(화면)에서 runner·experimenter·child·report를 연결한다.
import "./styles.css";

const app = document.getElementById("app");
if (app) {
  const p = document.createElement("p");
  p.textContent = "동화샘 시제품 — 화면은 단계 2에서 연결됩니다.";
  app.appendChild(p);
}
