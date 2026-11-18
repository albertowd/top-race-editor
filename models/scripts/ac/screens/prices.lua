-- the prices (PRICES), from the data of the screen
-- @data
local RED = rgbm(1, .06, .04, 1)
local LETTER = vec2(104, 250)
function update(dt)
	for i, p in ipairs(PRICES) do
		display.text{ pos = vec2(482 - LETTER.x * #p, (i - 1) * 512 + 130), letter = LETTER, text = p, font = "digital_big", color = RED }
	end
end
