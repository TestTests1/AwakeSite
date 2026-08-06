using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Queries.GetMapChunks;

public record GetMapChunksQuery(string Location) : IRequest<Result<string>>;
