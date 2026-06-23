# Alternativa Python — Astra Engine

Caso o Puppeteer raw (abordagem atual) apresente problemas, considere migrar para Python.

## Prós
- **Playwright** + automação por interface visual (mais resiliente que injetar JS)
- **Phone pairing** — login por código de 8 dígitos, sem QR Code
- API limpa e tipada
- Desenvolvimento ativo (fev/2026)

## Contras
- Beta (v0.0.3) — pode conter bugs
- Precisa reescrever toda a POC em Python
- Dependência de Python 3.9+ e Playwright

## Exemplo mínimo

```python
from astra_engine import Client

client = Client(session_id="whatsapp_poc")
client.on("message", lambda msg: print(f"{msg.from_jid}: {msg.text}"))
client.run_forever_sync()

# Enviar
client.send_text("SEU_NUMERO@s.whatsapp.net", "Olá!")
```

## Instalação
```bash
pip install astra-engine
playwright install chromium
```

## Referência
https://github.com/paman7647/Astra
