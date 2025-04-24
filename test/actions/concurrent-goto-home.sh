goto --url "http://localhost:8080/?sleep=1000" &
wait
assert_response_code_equal 200
