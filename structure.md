fieldclimate-dashboard/
├── public/
│   ├── index.html          # Versão limpa do dashboard
│   └── ConnectionAPI.js    # API client sem chaves
├── api/
│   └── fieldclimate.js     # Serverless function para proxy
├── .env.local              # Variáveis de ambiente (NÃO commitar)
├── .env.example           # Template das variáveis
├── vercel.json            # Configuração do Vercel
└── README.md              # Instruções de instalação