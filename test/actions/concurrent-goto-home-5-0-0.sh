goto --url "http://localhost:8080/?sleep=5000" &

tab_switch "2"
goto --url "http://localhost:8080/"
assert_response_code_equal 200
assert_query_returns_equal "//p" "User: alice"
tab_switch "1"

wait
assert_response_code_equal 200
assert_query_returns_equal "//p" "User: alice"
