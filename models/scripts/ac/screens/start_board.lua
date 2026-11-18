local order, timer = {}, 1
local flagLamps = ac.findMeshes("GANTRY_FLAG")
local flagTime, flagState, flagShown = 0, "", nil
local GREEN, YELLOW, RED, OFF = rgb(0, 24, 3), rgb(26, 17, 0), rgb(28, 0, 0), rgb(0, 0, 0)

local function setFlag(state, colour)
	if state ~= flagState then
		flagState = state
		flagLamps:setMaterialProperty("ksEmissive", colour)
	end
end

local function updateFlag(sim, dt)
	flagTime = flagTime + dt
	local waiting = sim.raceSessionType == 3 and sim.timeToSessionStart > 0
	if flagShown ~= (not waiting) then
		flagShown = not waiting
		flagLamps:setVisible(flagShown)
	end
	local f = sim.raceFlagType
	if f == ac.FlagType.Stop or f == ac.FlagType.SessionSuspended then
		setFlag("red", RED)
	elseif f == ac.FlagType.Caution then
		if flagTime % 1 < .5 then setFlag("yellow", YELLOW) else setFlag("off", OFF) end
	else
		setFlag("green", GREEN)
	end
end

local function lapText(ms)
	if ms <= 0 then return "" end
	local s = ms / 1000
	return string.format("%d:%06.3f", math.floor(s / 60), s % 60)
end

local function clockText(ms)
	local s = math.max(math.floor(ms / 1000), 0)
	return string.format("%d:%02d", math.floor(s / 60), s % 60)
end

local function refresh()
	local sim = ac.getSim()
	local list = {}
	for i = 0, sim.carsCount - 1 do
		local c = ac.getCar(i)
		if c ~= nil then
			list[#list + 1] = c
		end
	end
	table.sort(list, function(a, b) return a.racePosition < b.racePosition end)
	order = list
end

local function row(x, y, pos, letter)
	local c = order[pos]
	if c == nil then return end
	local col = rgbm(1, .06, .04, 1)
	local ms = c.previousLapTimeMs > 0 and c.previousLapTimeMs or c.bestLapTimeMs
	display.text{ pos = vec2(x, y), letter = letter, text = tostring(pos), font = "digital_big", color = col }
	display.text{ pos = vec2(x + letter.x * 2.2, y), letter = letter, text = tostring(ac.getDriverNumber(c.index)), font = "digital_big", color = col }
	display.text{ pos = vec2(x + letter.x * 5.2, y), letter = letter, text = lapText(ms), font = "digital_big", color = col }
end

function update(dt)
	timer = timer + dt
	if timer > .5 then
		timer = 0
		refresh()
	end
	local sim = ac.getSim()
	updateFlag(sim, dt)
	local letter = vec2(30, 60)
	for i = 0, 3 do
		row(10, 8 + i * 74, 1 + i, letter)
		row(968, 8 + i * 74, 7 + i, letter)
	end
	row(490, 8, 5, letter)
	row(490, 82, 6, letter)
	local race = sim.raceSessionType == 3
	local ms = math.max(sim.currentSessionTime, 0)
	display.text{ pos = vec2(609, 146), letter = vec2(48, 88), text = race and clockText(ms) or string.format("%02d:%02d", math.floor(sim.timeHours) % 24, math.floor(sim.timeMinutes) % 60), font = "digital_big", color = rgbm(1, .06, .04, 1) }
end
