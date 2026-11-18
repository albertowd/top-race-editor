-- the session: every car in order of its best lap
local WHITE, GREY, GREEN, AMBER = rgbm(.95, .95, .95, 1), rgbm(.7, .7, .74, 1), rgbm(.45, .86, .45, 1), rgbm(.92, .78, .24, 1)
local L, S = vec2(11, 20), vec2(8, 14)
local function get(o, k) local ok, v = pcall(function() return o[k] end) if ok then return v end return nil end
local function fmt(ms) if not ms or ms <= 0 then return "--:--.---" end return string.format("%02d:%06.3f", math.floor(ms / 60000), (ms % 60000) / 1000) end
local function clock(s) s = math.max(0, math.floor(s or 0)) return string.format("%02d:%02d:%02d", math.floor(s / 3600), math.floor(s / 60) % 60, s % 60) end
local function put(x, y, t, c, l) display.text{ pos = vec2(x, y), letter = l or S, text = t, font = "aria", color = c } end
function update(dt)
	local ok, sim = pcall(ac.getSim)
	if not ok or not sim then return end
	local n = get(sim, "carsCount") or 1
	local rows = {}
	for i = 0, n - 1 do
		local okc, car = pcall(ac.getCar, i)
		if okc and car then
			local okn, name = pcall(ac.getDriverName, i)
			rows[#rows + 1] = { name = okn and name or ("CAR " .. (i + 1)), best = get(car, "bestLapTimeMs") or 0,
				last = get(car, "previousLapTimeMs") or 0, laps = get(car, "lapCount") or 0 }
		end
	end
	table.sort(rows, function(a, b) if (a.best > 0) ~= (b.best > 0) then return a.best > 0 end return a.best < b.best end)
	local left = get(sim, "sessionTimeLeft")
	put(24, 16, "Session:", GREY) put(110, 16, "HOT LAP", WHITE)
	put(24, 40, "Timing:", GREY) put(110, 34, clock((get(sim, "timeHours") or 0) * 3600 + (get(sim, "timeMinutes") or 0) * 60 + (get(sim, "timeSeconds") or 0)), WHITE, vec2(15, 28))
	put(24, 68, "Time to go:", GREY) put(130, 68, clock(left and left / 1000 or 0), WHITE)
	display.rect{ pos = vec2(20, 92), size = vec2(984, 2), color = rgbm(.86, .86, .88, 1) }
	local fastest = rows[1] and rows[1].best or 0
	for k = 1, math.min(#rows, 13) do
		local r, y = rows[k], 100 + (k - 1) * 33
		put(24, y + 4, tostring(k), WHITE, L)
		put(70, y, string.upper(r.name), WHITE, L)
		put(70, y + 20, "Laps: " .. r.laps, GREY, vec2(6, 11))
		put(400, y + 6, "Last Time: " .. fmt(r.last), GREY)
		put(600, y + 6, "Best Time: " .. fmt(r.best), k == 1 and r.best > 0 and GREEN or WHITE)
		if k > 1 and r.best > 0 and fastest > 0 then put(820, y + 6, string.format("Diff: %.3f", (r.best - fastest) / 1000), GREY) end
		display.rect{ pos = vec2(20, y + 32), size = vec2(984, 1), color = rgbm(.35, .36, .4, 1) }
	end
	put(24, 554, "Timing and results are not official", AMBER, vec2(7, 12))
end
