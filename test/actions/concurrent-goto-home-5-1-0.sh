goto --url "http://localhost:8080/?sleep=5000" &

sleep 1

tab-switch "2"
goto --url "http://localhost:8080/"
assert-response-code-equal 200
assert-query-returns-equal "//p" "User: alice"
tab-switch "1"

wait
assert-response-code-equal 200
assert-query-returns-equal "//p" "User: alice"
