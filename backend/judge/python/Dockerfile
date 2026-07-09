FROM python:3.11-alpine

RUN apk add --no-cache nodejs openjdk17-jdk g++ \
  && addgroup -S judge \
  && adduser -S judge -G judge

WORKDIR /opt/judge
COPY run_python.py /opt/judge/run_python.py
USER judge

ENTRYPOINT ["python", "/opt/judge/run_python.py"]
