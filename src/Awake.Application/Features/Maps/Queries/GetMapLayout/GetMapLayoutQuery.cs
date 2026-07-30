using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Queries.GetMapLayout;

public record GetMapLayoutQuery(Guid Id) : IRequest<Result<MapLayoutDto>>;
