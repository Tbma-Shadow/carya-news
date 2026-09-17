# Energy Storage News Intelligence Platform

## Local development

Start PostgreSQL from the repository root:

```powershell
docker compose up -d postgres
```

Start the Spring Boot backend:

```powershell
cd backend
.\mvnw.cmd spring-boot:run
```

Start the Vite frontend in a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

The frontend is available at `http://localhost:5173`. During development, Vite proxies `/api`
requests to the backend at `http://localhost:8080`.
