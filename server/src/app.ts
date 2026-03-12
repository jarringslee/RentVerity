import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './config/db';
import authRouter from './routes/auth';
import housesRouter from './routes/houses';
import favoritesRouter from './routes/favorites';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 测试数据库连接
app.get('/test-db', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS result');
    res.json({ success: true, rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'DB connection failed' });
  }
});

// 业务路由
app.use('/auth', authRouter);
app.use('/houses', housesRouter);
app.use('/favorites', favoritesRouter);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

