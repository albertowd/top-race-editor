-- the hot lap times (TIMES: rank, brand, car, year, driver, ms, edition), the x of their columns
-- (COLUMNS), how many rows are shown, their height and where they begin, from the data of the screen
-- @data
local R, X, SHOW = TIMES, COLUMNS, SHOWN
local ORANGE, TEAL, WHITE = rgbm(1, .5, 0, 1), rgbm(.16, .78, .7, 1), rgbm(.94, .94, .94, 1)
local L = vec2(10, 18)
local scroll = 0
local function fmt(ms) return string.format("%d:%06.3f", math.floor(ms / 60000), (ms % 60000) / 1000) end
local function put(x, y, t, c, right) if right then x = x - #t * L.x end display.text{ pos = vec2(x, y), letter = L, text = t, font = "aria", color = c } end
function update(dt)
	display.rect{ pos = vec2(0, 0), size = vec2(1024, 64), color = rgbm(.13, .13, .13, 1) }
	display.text{ pos = vec2(60, 18), letter = vec2(15, 28), text = "HotLap", font = "aria", color = WHITE }
	display.text{ pos = vec2(512 - 13 * 11, 84), letter = vec2(22, 38), text = "Classificacao", font = "aria", color = ORANGE }
	display.rect{ pos = vec2(16, TOP - ROW), size = vec2(992, ROW), color = rgbm(.12, .12, .12, 1) }
	for i, h in ipairs({ "#", "Marca", "Modelo", "Ano", "Piloto(a)", "Tempo", "Edicao" }) do put(X[i], TOP - ROW + 6, h, WHITE, i == 6) end
	local best = 0
	local ok, car = pcall(ac.getCar, 0)
	if ok and car and car.bestLapTimeMs and car.bestLapTimeMs > 0 then best = car.bestLapTimeMs end
	local you = nil
	if best > 0 then you = #R + 1 for i = 1, #R do if R[i][6] > best then you = i break end end end
	local n = #R + (you and 1 or 0)
	if you then
		local target = math.max(0, math.min(n - SHOW, you - 1 - math.floor(SHOW / 2)))
		scroll = scroll + (target - scroll) * math.min(1, dt * 2)
	else
		scroll = (scroll + dt * .7) % n
	end
	local first = math.floor(scroll)
	for j = 0, SHOW - 1 do
		local p = (first + j) % n + 1
		local y = TOP + j * ROW
		if you and p == you then
			display.rect{ pos = vec2(16, y), size = vec2(992, ROW - 1), color = rgbm(1, .5, 0, .35) }
			put(X[1], y + 6, tostring(you), WHITE) put(X[5], y + 6, "@ VOCE", WHITE) put(X[6], y + 6, fmt(best), WHITE, true)
		else
			local r = R[(you and p > you) and p - 1 or p]
			local c = r[1] <= 3 and ORANGE or TEAL
			display.rect{ pos = vec2(16, y), size = vec2(992, ROW - 1), color = rgbm(.12, .12, .12, 1) }
			put(X[1], y + 6, tostring(r[1]), c) put(X[2], y + 6, r[2], c) put(X[3], y + 6, r[3], c) put(X[4], y + 6, r[4], c)
			put(X[5], y + 6, "@ " .. r[5], c) put(X[6], y + 6, fmt(r[6]), c, true) put(X[7], y + 6, r[7] .. ".", WHITE)
		end
	end
end
