import assert from "node:assert/strict";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

// Imports are dynamic because Mongo and authentication configuration must exist
// before the route modules initialize their shared database connection.
test("Owner -> Manager -> Sales authentication and user administration", { timeout: 120_000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "users-auth-integration";
  process.env.SESSION_SECRET = "integration-session-secret-longer-than-thirty-two";
  const auth = await import("../lib/auth.ts");
  process.env.OWNER_PASSWORD_HASH = auth.hashPassword("OwnerPass123!");
  const presets = await import("../app/user-permissions.ts");
  const usersRoute = await import("../app/api/settings/users/route.ts");
  const userRoute = await import("../app/api/settings/users/[id]/route.ts");
  const loginRoute = await import("../app/api/auth/login/route.ts");
  const reportsRoute = await import("../app/api/reports/route.ts");
  const { getMongo, getMongoClient } = await import("../lib/mongodb.ts");
  const origin = "http://conta.test";
  const login = async (username, password) => {
    const request = new Request(`${origin}/api/auth/login`, { method: "POST", headers: { origin, host: "conta.test" }, body: new URLSearchParams({ username, password }) });
    return loginRoute.POST(request);
  };
  const cookieFrom = response => response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const request = (path, cookie, init = {}) => new Request(`${origin}${path}`, { ...init, headers: { origin, host: "conta.test", cookie, ...(init.headers ?? {}) } });
  try {
    const ownerEnglish = await login("owner", "OwnerPass123!");
    const ownerArabic = await login("المالك", "OwnerPass123!");
    assert.equal(ownerEnglish.status, 303);
    assert.equal(ownerArabic.status, 303);
    assert.equal((await login("owner", "incorrect-password")).headers.get("location"), `${origin}/login?error=1`);
    const ownerCookie = cookieFrom(ownerEnglish);

    const managerResponse = await usersRoute.POST(request("/api/settings/users", ownerCookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "manager", password: "ManagerPass123!", permissions: presets.permissionPresets.manager }) }));
    assert.equal(managerResponse.status, 201);
    const manager = (await managerResponse.json()).user;
    assert.ok(manager.id);
    assert.equal("passwordHash" in manager, false);
    assert.equal("password" in manager, false);
    const managerRecord = await (await getMongo()).collection("users").findOne({ id: manager.id });
    assert.equal(managerRecord.usernameNormalized, "manager");
    assert.equal(managerRecord.name, "manager");
    assert.equal(managerRecord.isActive, true);
    assert.equal(managerRecord.password, undefined);
    assert.notEqual(managerRecord.passwordHash, "ManagerPass123!");
    assert.equal(auth.verifyPasswordHash("ManagerPass123!", managerRecord.passwordHash), true);


    const seller2Response = await usersRoute.POST(request("/api/settings/users", ownerCookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "seller2", password: "SellerPass123!", permissions: ["pos.view", "pos.create"] }) }));
    assert.equal(seller2Response.status, 201);
    const seller2Record = await (await getMongo()).collection("users").findOne({ id: (await seller2Response.json()).user.id });
    assert.equal(seller2Record.name, "seller2");
    assert.equal(seller2Record.isActive, true);
    assert.equal((await login("seller2", "SellerPass123!")).status, 303);
    const duplicate = await usersRoute.POST(request("/api/settings/users", ownerCookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Duplicate", username: "MANAGER", password: "Duplicate123!", permissions: [] }) }));
    assert.equal(duplicate.status, 409);
    const managerLogin = await login("manager", "ManagerPass123!");
    assert.equal(managerLogin.status, 303);
    const managerCookie = cookieFrom(managerLogin);
    assert.equal((await usersRoute.GET(request("/api/settings/users", managerCookie))).status, 200);

    const salesResponse = await usersRoute.POST(request("/api/settings/users", managerCookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "البائع", username: "sales", password: "SalesPass123!", isActive: true, permissions: presets.permissionPresets.sales }) }));
    assert.equal(salesResponse.status, 201);
    const sales = (await salesResponse.json()).user;
    const salesLogin = await login("sales", "SalesPass123!");
    assert.equal(salesLogin.status, 303);
    const salesCookie = cookieFrom(salesLogin);
    assert.equal((await usersRoute.GET(request("/api/settings/users", salesCookie))).status, 403);
    assert.equal((await reportsRoute.GET(request("/api/reports", salesCookie))).status, 403);

    const usersList = await usersRoute.GET(request("/api/settings/users", managerCookie));
    const usersBody = await usersList.json();
    assert.equal(JSON.stringify(usersBody).includes("passwordHash"), false);
    assert.equal(usersBody.users.length, 3);

    const blankPasswordUpdate = await userRoute.PUT(request(`/api/settings/users/${sales.id}`, managerCookie, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...sales, password: "", isActive: true }) }), { params: Promise.resolve({ id: sales.id }) });
    assert.equal(blankPasswordUpdate.status, 200);
    assert.equal((await login("sales", "SalesPass123!")).status, 303);
    const passwordUpdate = await userRoute.PUT(request(`/api/settings/users/${sales.id}`, managerCookie, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...sales, password: "NewSalesPass123!", isActive: true }) }), { params: Promise.resolve({ id: sales.id }) });
    assert.equal(passwordUpdate.status, 200);
    assert.equal((await login("sales", "SalesPass123!")).headers.get("location"), `${origin}/login?error=1`);
    const newSalesLogin = await login("sales", "NewSalesPass123!");
    const activeSalesCookie = cookieFrom(newSalesLogin);
    assert.equal(newSalesLogin.status, 303);

    const disable = await userRoute.PUT(request(`/api/settings/users/${sales.id}`, managerCookie, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...sales, password: "", isActive: false }) }), { params: Promise.resolve({ id: sales.id }) });
    assert.equal(disable.status, 200);
    assert.equal((await login("sales", "NewSalesPass123!")).headers.get("location"), `${origin}/login?error=1`);
    assert.equal((await reportsRoute.GET(request("/api/reports", activeSalesCookie))).status, 401);
  } finally {
    await getMongoClient().close();
    await mongo.stop();
  }
});
