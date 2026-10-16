import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { AppError } from '../utils/AppError';
import { buildHouseSearchSql, parseHouseFilters, parseHouseQuery } from '../houses/filters';
import { createHouseRepository } from '../houses/repository';
import { createHousesRouter } from '../routes/houses';

test('price upper bound can be omitted and zero is not treated as missing', () => {
  const over4000 = buildHouseSearchSql(parseHouseQuery({ minPrice: '4000' }));
  assert.ok(over4000.listSql.includes('price >= ?'));
  assert.ok(!over4000.listSql.includes('price <= ?'));
  assert.equal(over4000.listParams[0], 4000);
  assert.equal(parseHouseQuery({ maxPrice: '0' }).maxPrice, 0);
});

test('city is normalized and bound independently from address; room type is not guessed by SQL title matching', () => {
  const plan = buildHouseSearchSql(parseHouseQuery({ city: '西安', location: '高新区', houseTypes: '一居室,两居室' }));
  assert.match(plan.listSql, /city = \?/); assert.match(plan.listSql, /house_type IN \(\?, \?\)/);
  assert.deepEqual(plan.countParams, ['西安市', '%高新区%', '%高新区%', '一居室', '两居室']);
  assert.throws(() => parseHouseQuery({ city: '高新区' }), AppError);
});

test('invalid prices, pagination, repeated fields and sorting are rejected', () => {
  for (const input of [
    { minPrice: '4000', maxPrice: '0' }, { minPrice: '-1' }, { maxPrice: 'Infinity' },
    { page: '0' }, { page: '1.5' }, { pageSize: '101' }, { pageSize: '2000' },
    { houseTypes: '别墅' }, { sort: 'price; DROP TABLE houses' }, { location: ['a', 'b'] }, { riskLevels: 'low' }
  ]) assert.throws(() => parseHouseQuery(input), AppError);
  assert.throws(() => parseHouseFilters({ maxPrice: '3000' }), AppError);
  assert.throws(() => parseHouseFilters({ minPrice: 4000, maxPrice: 3000 }), AppError);
});

test('SQL binds literal wildcard and injection-looking keywords; page and count share conditions', () => {
  const location = "高新区%_' OR 1=1 --";
  const query = parseHouseQuery({ location, minPrice: '1000', maxPrice: '3000', houseTypes: '一居室,合租', page: '2', pageSize: '3', sort: 'price_asc' });
  const plan = buildHouseSearchSql(query);
  assert.ok(!plan.listSql.includes(location));
  assert.ok(plan.countParams[0] === "%高新区!%!_' OR 1=1 --%");
  assert.deepEqual(plan.listParams.slice(0, -2), plan.countParams);
  assert.deepEqual(plan.listParams.slice(-2), [3, 3]);
  assert.match(plan.listSql, /ORDER BY price ASC, id DESC LIMIT \? OFFSET \?$/);
  assert.equal(plan.listSql.slice(plan.listSql.indexOf(' FROM '), plan.listSql.indexOf(' ORDER BY ')), plan.countSql.slice(plan.countSql.indexOf(' FROM ')));
});

test('repository normalizes numeric rows and preserves pagination total', async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const repository = createHouseRepository(async (sql, params) => {
    calls.push({ sql, params });
    return sql.startsWith('SELECT COUNT') ? [{ total: '3' }] : [{ id: '1', title: '高新区一居室', price: '2800', location: '高新区', image: '', description: '' }];
  });
  const result = await repository.search(parseHouseQuery({ location: '高新区', maxPrice: '3000', pageSize: '1' }));
  assert.equal(result.total, 3);
  assert.equal(result.list[0].price, 2800);
  assert.equal(result.list[0].id, 1);
  assert.equal(result.pageSize, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params.slice(0, -2), calls[1].params);
});

test('GET /houses validates input before repository access and forwards every page filter', async t => {
  const queries: unknown[] = [];
  const app = express();
  app.use('/houses', createHousesRouter({ search: async query => { queries.push(query); return { list: [], total: 4, page: query.page, pageSize: query.pageSize }; } }));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/houses`;
  assert.equal((await fetch(`${base}?pageSize=2000`)).status, 400);
  assert.equal(queries.length, 0);
  const response = await fetch(`${base}?location=${encodeURIComponent('高新区')}&maxPrice=3000&houseTypes=${encodeURIComponent('一居室')}&page=2&pageSize=1`);
  assert.equal(response.status, 200);
  assert.deepEqual(queries[0], { location: '高新区', maxPrice: 3000, houseTypes: ['一居室'], page: 2, pageSize: 1, sort: 'latest' });
});

test('map bounds are finite, ordered and never silently dropped', () => {
  for (const bounds of ['', '108,34,109', '108,,109,35', 'x,34,109,35', '109,34,108,35', '108,35,109,34', '-181,34,109,35', '108,34,181,35', '108,-91,109,35', '108,34,109,91', '108,34,108,35', '108,34,Infinity,35']) {
    assert.throws(() => parseHouseQuery({ bounds }), AppError);
  }
  assert.throws(() => parseHouseQuery({ bounds: ['108,34,109,35', '108,34,109,35'] }), AppError);
  const parsed = parseHouseQuery({ bounds: '108.92,34.23,109.04,34.31', minPrice: '2000', page: '2', pageSize: '2' });
  assert.deepEqual(parsed.bounds, { west: 108.92, south: 34.23, east: 109.04, north: 34.31 });
  const sql = buildHouseSearchSql(parsed);
  assert.match(sql.listSql, /lng BETWEEN \? AND \? AND lat BETWEEN \? AND \?/);
  assert.deepEqual(sql.countParams, [2000, 108.92, 109.04, 34.23, 34.31]);
  assert.deepEqual(sql.listParams, [...sql.countParams, 2, 2]);
});
