# HUAN 可觀測性後端

server 與 worker 透過 OpenTelemetry 把 trace、log、metric 以 OTLP/HTTP 送出（`@huan/telemetry`）。這個目錄是收那些資料的後端，以及 Grafana 的資料來源與儀表板。

```text
huan-server ─┐                      ┌─ trace  → Tempo ── span metrics ─┐
             ├─ OTLP/HTTP → Alloy ──┼─ log    → Loki                   ├→ Grafana
huan-worker ─┘                      └─ metric → Prometheus ←───────────┘
```

設計理由見 [ADR-0009](https://docs.linyao.tw/huan/dev/adr/0009-opentelemetry)，使用方式見 <https://docs.linyao.tw/huan/dev/observability>。

## 目錄內容

| 檔案                            | 用途                                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| `compose.yaml`                  | Alloy、Tempo、Loki、Prometheus。不含 Grafana                          |
| `alloy.alloy`                   | OTLP 收件、批次、分流到三個後端                                       |
| `tempo.yaml`                    | trace 保留 14 天；從 trace 產生每個路由、查詢、轉檔步驟的請求數與延遲 |
| `loki.yaml`                     | log 保留 30 天；`trace_id` 存成結構化 metadata                        |
| `prometheus.yml`                | 指標保留 90 天；接收 OTLP 與 Tempo 的 remote write                    |
| `grafana/datasources/huan.yaml` | 三個資料來源，互相連結（trace ↔ log、指標 → trace）                   |
| `grafana/dashboards/`           | 「HUAN 服務總覽」儀表板與它的 provider 設定                           |

## 部署

正式環境放在 emfox 的 `/opt/huan-observability`，Grafana 沿用同一台上既有的 `ups-grafana`。

```sh
# 後端
scp compose.yaml alloy.alloy tempo.yaml loki.yaml prometheus.yml emfox:/tmp/huan-obs/
ssh emfox
sudo install -m 644 /tmp/huan-obs/* /opt/huan-observability/
echo GRAFANA_NETWORK=ups-grafana_default | sudo tee /opt/huan-observability/.env
cd /opt/huan-observability && sudo docker compose up -d

# Grafana：資料來源與儀表板都走 provisioning
G=/opt/ups-grafana/grafana/provisioning
sudo install -m 644 grafana/datasources/huan.yaml $G/datasources/huan.yaml
sudo install -m 644 grafana/dashboards/huan.yaml $G/dashboards/huan.yaml
sudo install -D -m 644 grafana/dashboards/huan-overview.json $G/dashboards/huan/huan-overview.json
sudo docker restart ups-grafana-grafana-1
```

儀表板 JSON 只要覆蓋過去，Grafana 30 秒內會自己重新載入；資料來源改了才需要重啟。在 Grafana 介面裡改儀表板不會被保存，要改就改這裡的 JSON。

## 對外入口

Alloy 只綁在 `127.0.0.1:4318`，OTLP 收件口本身沒有驗證。對外經 Cloudflare Tunnel（`huan-otlp.elvismao.com`），Cloudflare Access 只放行 HUAN 主機的出口 IP，其他來源一律 403。

HUAN 端只需要：

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=https://huan-otlp.elvismao.com
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production
```

沒有設定 `OTEL_EXPORTER_OTLP_ENDPOINT` 時 SDK 完全不啟動，HUAN 照常運作。

## 不會記錄的東西

- 請求網址的查詢字串（可能帶著簽章或 token）。trace 的 `url.query` 一律是空的，log 的網址也先去掉查詢字串。
- 配對碼路徑 `/pairing/<配對碼>` 記成 `/pairing/***`。
- SQL 參數。資料庫 span 只記 SQL 樣板，不記綁定的值。
- 請求與回應的標頭、內文。
