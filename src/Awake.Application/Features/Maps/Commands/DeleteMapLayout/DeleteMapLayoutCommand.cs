using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Commands.DeleteMapLayout;

public record DeleteMapLayoutCommand(Guid Id) : IRequest<Result<bool>>;
