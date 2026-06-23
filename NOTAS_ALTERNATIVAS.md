# Alternativa Python — Astra Engine

Caso o Puppeteer raw (abordagem atual no Node.js) apresente problemas, considere migrar para Python com Playwright.

---

## Por que Python?

- **Playwright** — automação por interface visual (mais resiliente que injetar JS)
- **Phone pairing** — login por código de 8 dígitos, sem QR Code
- **API síncrona e tipada** — mais fácil de debugar
- **Suporte da comunidade** — várias libs: `webwhats-api`, `whatsapp-playwright`, `Astra`

---

## Contras

- Beta (Astra v0.0.3) — pode conter bugs
- Precisa reescrever toda a POC em Python
- Dependência de Python 3.9+ e Playwright
- Se o time não souber Python, curva de aprendizado

---

## Opções de Biblioteca

| Biblioteca | Estrelas | Manutenção | Diferencial |
|-----------|----------|------------|-------------|
| **Astra Engine** | ~1k | Ativa (2026) | Phone pairing, beta |
| **webwhats-api** | ~500 | Moderada | Similar ao whatsapp-web.js |
| **Playwright puro** | N/A | Google | Controle total, mais trabalho |

---

## Exemplo com Playwright puro (sem lib)

```python
import asyncio
from playwright.async_api import async_playwright

async def send_message(number: str, text: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
        await page.goto(f"https://web.whatsapp.com/send?phone={number}")
        await page.wait_for_timeout(5000)
        
        input_box = page.locator('div[contenteditable="true"]').first
        await input_box.click()
        await input_box.fill(text)
        await page.keyboard.press("Enter")
        
        await page.wait_for_timeout(2000)
        await browser.close()

asyncio.run(send_message("SEU_NUMERO", "Teste Python!"))
```

## Exemplo com Astra Engine

```python
from astra_engine import Client

client = Client(session_id="whatsapp_poc")

@client.event
def on_message(msg):
    print(f"{msg.from_jid}: {msg.text}")

client.start()
client.send_text("SEU_NUMERO@s.whatsapp.net", "Olá!")
```

---

## Instalação

```bash
pip install astra-engine playwright
playwright install chromium
```

---

## Integração com Salesforce (Python)

Mesmo fluxo do Node.js:

```
Salesforce (Flow/Trigger) → HTTP POST → Servidor Python → WhatsApp Web
                                           ↓ (quando chega resposta)
                                        HTTP POST → Salesforce REST API
```

Única diferença: o servidor seria Flask/FastAPI em vez de Express.

---

## Quando Migrar para Python

- Puppeteer quebrar com frequência e Playwright resolver
- Time for exclusivamente Python
- Precisar de phone pairing (sem QR)
- Quiser testar a abordagem mais recente

---

## Referências

- https://github.com/paman7647/Astra
- https://playwright.dev/python/
- https://pypi.org/project/webwhats-api/

---

> **Nota:** veja `PLANO_WHATS_WEB.md` para o plano detalhado de produção com Node.js (recomendado para agora).
