cp -r ./var/netero/browser/1/tab/1 ./var/netero/browser/1/tab/2

goto --url "http://localhost:8080/?sleep=5000" &

sleep 1

tab_switch "2"
goto --url "http://localhost:8080/"
assert_response_code_equal 200
assert_query_returns_equal "//p" "User: alice, Device: iphone"
tab_switch "1"

wait
assert_response_code_equal 200
assert_query_returns_equal "//p" "User: alice, Device: iphone"
